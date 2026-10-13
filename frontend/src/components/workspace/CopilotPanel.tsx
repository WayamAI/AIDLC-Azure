import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopilotChat } from "./CopilotChat";
import { SnippetLibrary } from "./SnippetLibrary";
import { TestGenerator } from "./TestGenerator";

const tabPill =
  "h-auto rounded-full border border-border px-3 py-1 text-xs font-medium text-ink-secondary shadow-none hover:bg-raised data-[state=active]:border-transparent data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none";

export function CopilotPanel() {
  return (
    <div className="h-full flex flex-col border-l border-stroke-muted">
      <Tabs defaultValue="chat" className="flex flex-col h-full">
        <TabsList className="w-full rounded-none border-b border-stroke-muted bg-container h-11 flex-shrink-0 justify-start gap-1.5 px-3">
          <TabsTrigger value="chat" className={tabPill}>
            Copilot
          </TabsTrigger>
          <TabsTrigger value="tests" className={tabPill}>
            Tests
          </TabsTrigger>
          <TabsTrigger value="snippets" className={tabPill}>
            Snippets
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="flex-1 min-h-0 mt-0">
          <CopilotChat />
        </TabsContent>
        <TabsContent value="tests" className="flex-1 min-h-0 mt-0">
          <TestGenerator />
        </TabsContent>
        <TabsContent value="snippets" className="flex-1 min-h-0 mt-0">
          <SnippetLibrary />
        </TabsContent>
      </Tabs>
    </div>
  );
}
