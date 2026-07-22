# AI PR Reviewer - Single File Pack

This document puts everything in one place for reusing AI PR Reviewer in your own frontend-driven product.

It includes:
- Reusable function-style code structure
- Input contract (repo, branch, PR)
- Backend API shape
- Prompt templates used by the reviewer
- System and summary prompts from action configuration

## 1) Reusable Function Contract

~~~ts
export type ReviewRequest = {
  owner: string
  repo: string
  base: string              // base branch or base SHA
  head: string              // target branch or head SHA
  prNumber?: number         // optional, useful if you want PR metadata
  githubToken: string
  openaiKey: string
  openaiOrg?: string
  options?: {
    debug?: boolean
    disableReview?: boolean
    disableReleaseNotes?: boolean
    maxFiles?: number
    reviewSimpleChanges?: boolean
    reviewCommentLGTM?: boolean
    pathFilters?: string[]
    systemMessage?: string
    openaiLightModel?: string
    openaiHeavyModel?: string
    openaiModelTemperature?: number
    openaiRetries?: number
    openaiTimeoutMS?: number
    openaiConcurrencyLimit?: number
    githubConcurrencyLimit?: number
    apiBaseUrl?: string
    language?: string
  }
}

export type ReviewFinding = {
  file: string
  startLine: number
  endLine: number
  comment: string
  severity?: 'low' | 'medium' | 'high'
}

export type FileSummary = {
  file: string
  summary: string
  needsReview: boolean
}

export type ReviewResult = {
  title: string
  description: string
  shortSummary: string
  finalSummary: string
  releaseNotes?: string
  fileSummaries: FileSummary[]
  findings: ReviewFinding[]
  skippedFiles: string[]
  failedFiles: string[]
  meta: {
    owner: string
    repo: string
    base: string
    head: string
    prNumber?: number
  }
}
~~~

## 2) Service-Style Runner (No GitHub Action Dependency)

~~~ts
import pLimit from 'p-limit'
import {Octokit} from '@octokit/rest'
import {Bot} from './src/bot'
import {Options, OpenAIOptions} from './src/options'
import {Prompts} from './src/prompts'
import {Inputs} from './src/inputs'
import {getTokenCount} from './src/tokenizer'

export async function reviewPullRequest(req: ReviewRequest): Promise<ReviewResult> {
  process.env.OPENAI_API_KEY = req.openaiKey
  if (req.openaiOrg) process.env.OPENAI_API_ORG = req.openaiOrg

  const octokit = new Octokit({auth: req.githubToken})

  const options = new Options(
    req.options?.debug ?? false,
    req.options?.disableReview ?? false,
    req.options?.disableReleaseNotes ?? false,
    String(req.options?.maxFiles ?? 150),
    req.options?.reviewSimpleChanges ?? false,
    req.options?.reviewCommentLGTM ?? false,
    req.options?.pathFilters ?? null,
    req.options?.systemMessage ?? DEFAULT_SYSTEM_MESSAGE,
    req.options?.openaiLightModel ?? 'gpt-4o-mini',
    req.options?.openaiHeavyModel ?? 'gpt-4.1',
    String(req.options?.openaiModelTemperature ?? 0.05),
    String(req.options?.openaiRetries ?? 5),
    String(req.options?.openaiTimeoutMS ?? 360000),
    String(req.options?.openaiConcurrencyLimit ?? 6),
    String(req.options?.githubConcurrencyLimit ?? 6),
    req.options?.apiBaseUrl ?? 'https://api.openai.com/v1',
    req.options?.language ?? 'en-US'
  )

  const prompts = new Prompts(DEFAULT_SUMMARIZE_PROMPT, DEFAULT_RELEASE_NOTES_PROMPT)

  const lightBot = new Bot(options, new OpenAIOptions(options.openaiLightModel, options.lightTokenLimits))
  const heavyBot = new Bot(options, new OpenAIOptions(options.openaiHeavyModel, options.heavyTokenLimits))

  const openaiLimit = pLimit(options.openaiConcurrencyLimit)
  const githubLimit = pLimit(options.githubConcurrencyLimit)

  const compare = await octokit.repos.compareCommits({
    owner: req.owner,
    repo: req.repo,
    base: req.base,
    head: req.head
  })

  const changedFiles = compare.data.files ?? []
  const commits = compare.data.commits ?? []

  const inputs = new Inputs()
  inputs.title = req.prNumber
    ? `PR #${req.prNumber} (${req.owner}/${req.repo})`
    : `Branch comparison (${req.owner}/${req.repo})`
  inputs.description = `Base: ${req.base}\nHead: ${req.head}`
  inputs.systemMessage = options.systemMessage

  const fileSummaries: FileSummary[] = []
  const findings: ReviewFinding[] = []
  const skippedFiles: string[] = []
  const failedFiles: string[] = []

  for (const file of changedFiles) {
    if (!file.filename || !options.checkPath(file.filename)) {
      if (file.filename) skippedFiles.push(file.filename)
      continue
    }

    const patch = file.patch ?? ''
    if (!patch) {
      skippedFiles.push(file.filename)
      continue
    }

    const ins = inputs.clone()
    ins.filename = file.filename
    ins.fileDiff = patch

    const summarizePrompt = prompts.renderSummarizeFileDiff(ins, options.reviewSimpleChanges)
    if (getTokenCount(summarizePrompt) > options.lightTokenLimits.requestTokens) {
      failedFiles.push(`${file.filename} (summary tokens exceeded)`)
      continue
    }

    const [summaryText] = await openaiLimit(() => lightBot.chat(summarizePrompt, {}))
    if (!summaryText) {
      failedFiles.push(`${file.filename} (empty summary response)`)
      continue
    }

    let needsReview = true
    let cleanSummary = summaryText
    const triageMatch = summaryText.match(/\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/)
    if (triageMatch) {
      needsReview = triageMatch[1] === 'NEEDS_REVIEW'
      cleanSummary = summaryText.replace(/\[TRIAGE\]:\s*(NEEDS_REVIEW|APPROVED)/, '').trim()
    }

    fileSummaries.push({
      file: file.filename,
      summary: cleanSummary,
      needsReview
    })

    if (!options.disableReview && needsReview) {
      const reviewIns = inputs.clone()
      reviewIns.filename = file.filename
      reviewIns.shortSummary = cleanSummary
      reviewIns.patches = `---new_hunk---\n~~~\n${patch}\n~~~\n---old_hunk---\n~~~\n(unavailable in branch compare only mode)\n~~~\n---end_change_section---`

      const reviewPrompt = prompts.renderReviewFileDiff(reviewIns)
      if (getTokenCount(reviewPrompt) > options.heavyTokenLimits.requestTokens) {
        failedFiles.push(`${file.filename} (review tokens exceeded)`)
        continue
      }

      const [reviewText] = await openaiLimit(() => heavyBot.chat(reviewPrompt, {}))
      if (!reviewText) continue

      findings.push({
        file: file.filename,
        startLine: 1,
        endLine: 1,
        comment: reviewText
      })
    }
  }

  const rollupInputs = inputs.clone()
  rollupInputs.rawSummary = fileSummaries.map(s => `---\n${s.file}: ${s.summary}`).join('\n')

  const [finalSummary] = await heavyBot.chat(prompts.renderSummarize(rollupInputs), {})
  const [shortSummary] = await heavyBot.chat(prompts.renderSummarizeShort(rollupInputs), {})

  let releaseNotes: string | undefined = undefined
  if (!options.disableReleaseNotes) {
    const [rn] = await heavyBot.chat(prompts.renderSummarizeReleaseNotes(rollupInputs), {})
    releaseNotes = rn || undefined
  }

  return {
    title: inputs.title,
    description: inputs.description,
    shortSummary: shortSummary || '',
    finalSummary: finalSummary || '',
    releaseNotes,
    fileSummaries,
    findings,
    skippedFiles,
    failedFiles,
    meta: {
      owner: req.owner,
      repo: req.repo,
      base: req.base,
      head: req.head,
      prNumber: req.prNumber
    }
  }
}
~~~

## 3) Suggested API Endpoints

~~~ts
// POST /reviews
// body: ReviewRequest
// response: { reviewId: string, status: 'queued' }

// GET /reviews/:id
// response: { status, progress, startedAt, completedAt }

// GET /reviews/:id/result
// response: ReviewResult
~~~

## 4) All Prompt Templates (Core App)

### 4.1 summarizeFileDiff

~~~text
## GitHub PR Title

`$title` 

## Description

```
$description
```

## Diff

```diff
$file_diff
```

## Instructions

I would like you to succinctly summarize the diff within 100 words.
If applicable, your summary should include a note about alterations 
to the signatures of exported functions, global data structures and 
variables, and any changes that might affect the external interface or 
behavior of the code.
~~~

### 4.2 triageFileDiff

~~~text
Below the summary, I would also like you to triage the diff as `NEEDS_REVIEW` or 
`APPROVED` based on the following criteria:

- If the diff involves any modifications to the logic or functionality, even if they 
  seem minor, triage it as `NEEDS_REVIEW`. This includes changes to control structures, 
  function calls, or variable assignments that might impact the behavior of the code.
- If the diff only contains very minor changes that don't affect the code logic, such as 
  fixing typos, formatting, or renaming variables for clarity, triage it as `APPROVED`.

Please evaluate the diff thoroughly and take into account factors such as the number of 
lines changed, the potential impact on the overall system, and the likelihood of 
introducing new bugs or security vulnerabilities. 
When in doubt, always err on the side of caution and triage the diff as `NEEDS_REVIEW`.

You must strictly follow the format below for triaging the diff:
[TRIAGE]: <NEEDS_REVIEW or APPROVED>

Important:
- In your summary do not mention that the file needs a through review or caution about
  potential issues.
- Do not provide any reasoning why you triaged the diff as `NEEDS_REVIEW` or `APPROVED`.
- Do not mention that these changes affect the logic or functionality of the code in 
  the summary. You must only use the triage status format above to indicate that.
~~~

### 4.3 summarizeChangesets

~~~text
Provided below are changesets in this pull request. Changesets 
are in chronlogical order and new changesets are appended to the
end of the list. The format consists of filename(s) and the summary 
of changes for those files. There is a separator between each changeset.
Your task is to deduplicate and group together files with
related/similar changes into a single changeset. Respond with the updated 
changesets using the same format as the input. 

$raw_summary
~~~

### 4.4 summarizePrefix

~~~text
Here is the summary of changes you have generated for files:
      ```
      $raw_summary
      ```
~~~

### 4.5 summarizeShort

~~~text
Your task is to provide a concise summary of the changes. This 
summary will be used as a prompt while reviewing each file and must be very clear for 
the AI bot to understand. 

Instructions:

- Focus on summarizing only the changes in the PR and stick to the facts.
- Do not provide any instructions to the bot on how to perform the review.
- Do not mention that files need a through review or caution about potential issues.
- Do not mention that these changes affect the logic or functionality of the code.
- The summary should not exceed 500 words.
~~~

### 4.6 reviewFileDiff

~~~text
## GitHub PR Title

`$title` 

## Description

```
$description
```

## Summary of changes

```
$short_summary
```

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: PR title, description, summaries and comment chains.
Task: Review new hunks for substantive issues using provided context and respond with comments if necessary.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use `suggestion` code blocks.
For fixes, use `diff` code blocks, marking changes with `+` or `-`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

- Do NOT provide general feedback, summaries, explanations of changes, or praises 
  for making good additions. 
- Focus solely on offering specific, objective insights based on the 
  given context and refrain from making broad comments about potential impacts on 
  the system or question intentions behind the changes.

If there are no issues found on a line range, you MUST respond with the 
text `LGTM!` for that line range in the review section. 

## Example

### Example changes

---new_hunk---
```
  z = x / y
    return z

20: def add(x, y):
21:     z = x + y
22:     retrn z
23: 
24: def multiply(x, y):
25:     return x * y

def subtract(x, y):
  z = x - y
```
  
---old_hunk---
```
  z = x / y
    return z

def add(x, y):
    return x + y

def subtract(x, y):
    z = x - y
```

---comment_chains---
```
Please review this change.
```

---end_change_section---

### Example response

22-22:
There's a syntax error in the add function.
```diff
-    retrn z
+    return z
```
---
24-25:
LGTM!
---

## Changes made to `$filename` for your review

$patches
~~~

### 4.7 comment prompt

~~~text
A comment was made on a GitHub PR review for a 
diff hunk on a file - `$filename`. I would like you to follow 
the instructions in that comment. 

## GitHub PR Title

`$title`

## Description

```
$description
```

## Summary generated by the AI bot

```
$short_summary
```

## Entire diff

```diff
$file_diff
```

## Diff being commented on

```diff
$diff
```

## Instructions

Please reply directly to the new comment (instead of suggesting 
a reply) and your reply will be posted as-is.

If the comment contains instructions/requests for you, please comply. 
For example, if the comment is asking you to generate documentation 
comments on the code, in your reply please generate the required code.

In your reply, please make sure to begin the reply by tagging the user 
with "@user".

## Comment format

`user: comment`

## Comment chain (including the new comment)

```
$comment_chain
```

## The comment/request that you need to directly reply to

```
$comment
```
~~~

## 5) Action-Level Default Prompts (Configuration)

### 5.1 Default system_message

~~~text
You are `@coderabbitai` (aka `github-actions[bot]`), a language model 
trained by OpenAI. Your purpose is to act as a highly experienced 
software engineer and provide a thorough review of the code hunks
and suggest code snippets to improve key areas such as:
  - Logic
  - Security
  - Performance
  - Data races
  - Consistency
  - Error handling
  - Maintainability
  - Modularity
  - Complexity
  - Optimization
  - Best practices: DRY, SOLID, KISS

Do not comment on minor code style issues, missing 
comments/documentation. Identify and resolve significant 
concerns to improve overall code quality while deliberately 
disregarding minor issues.
~~~

### 5.2 Default summarize

~~~text
Provide your final response in markdown with the following content:

- Walkthrough: A high-level summary of the overall change instead of 
  specific files within 80 words.
- Changes: A markdown table of files and their summaries. Group files 
  with similar changes together into a single row to save space.
- Poem: Below the changes, include a whimsical, short poem written by 
  a rabbit to celebrate the changes. Format the poem as a quote using 
  the ">" symbol and feel free to use emojis where relevant.

Avoid additional commentary as this summary will be added as a comment on the 
GitHub pull request. Use the titles "Walkthrough" and "Changes" and they must be H2.
~~~

### 5.3 Default summarize_release_notes

~~~text
Craft concise release notes for the pull request. 
Focus on the purpose and user impact, categorizing changes as "New Feature", "Bug Fix", 
"Documentation", "Refactor", "Style", "Test", "Chore", or "Revert". Provide a bullet-point list, 
e.g., "- New Feature: Added search functionality to the UI". Limit your response to 50-100 words 
and emphasize features visible to the end-user while omitting code-level details.
~~~

## 6) Frontend Integration Data Flow

1. Frontend sends repo, base, head, optional PR number.
2. Backend creates review job and runs reviewPullRequest.
3. Backend stores result JSON.
4. Frontend renders:
   - Final summary
   - Release notes
   - File summaries
   - Findings with line ranges

## 7) Minimal JSON Example

~~~json
{
  "owner": "your-org",
  "repo": "your-repo",
  "base": "main",
  "head": "feature/improve-auth",
  "prNumber": 128,
  "githubToken": "ghp_xxx",
  "openaiKey": "sk-xxx",
  "options": {
    "openaiHeavyModel": "gpt-4.1",
    "openaiLightModel": "gpt-4o-mini",
    "reviewSimpleChanges": false,
    "disableReleaseNotes": false,
    "language": "en-US"
  }
}
~~~

## 8) Notes

- Original project is GitHub Action-centric, so UI-first usage needs service wrappers.
- Keep comment-posting optional and separate from core analysis.
- Preserve token limits and path filters to control costs and latency.
