import { useState } from "react";
import { Search, Trash2, Copy, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSnippets, useCreateSnippet, useDeleteSnippet } from "@/hooks/use-snippets";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { toast } from "sonner";

export function SnippetLibrary() {
  const { workspace } = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newLang, setNewLang] = useState("python");
  const [newTags, setNewTags] = useState("");

  const { data: snippets = [], isLoading } = useSnippets(workspace?.workspace_id);
  const createSnippet = useCreateSnippet();
  const deleteSnippet = useDeleteSnippet();

  const filtered = snippets.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreate = async () => {
    if (!workspace || !newName.trim() || !newCode.trim()) return;
    try {
      await createSnippet.mutateAsync({
        workspace_id: workspace.workspace_id,
        name: newName,
        code: newCode,
        language: newLang,
        tags: newTags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      toast.success("Snippet saved");
      setCreateOpen(false);
      setNewName(""); setNewCode(""); setNewTags("");
    } catch {
      toast.error("Failed to save snippet");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSnippet.mutateAsync(id);
      toast.success("Snippet deleted");
    } catch {
      toast.error("Failed to delete snippet");
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border/50 space-y-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search snippets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full h-7 text-xs">
              <Plus className="h-3 w-3 mr-1" /> New Snippet
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Save Snippet</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1" placeholder="retry_decorator" />
              </div>
              <div>
                <Label className="text-xs">Language</Label>
                <Input value={newLang} onChange={(e) => setNewLang(e.target.value)} className="mt-1" placeholder="python" />
              </div>
              <div>
                <Label className="text-xs">Tags (comma-separated)</Label>
                <Input value={newTags} onChange={(e) => setNewTags(e.target.value)} className="mt-1" placeholder="retry, async, utility" />
              </div>
              <div>
                <Label className="text-xs">Code</Label>
                <Textarea value={newCode} onChange={(e) => setNewCode(e.target.value)} className="mt-1 font-mono text-xs min-h-[120px]" placeholder="# paste your code here" />
              </div>
              <Button onClick={handleCreate} className="w-full" disabled={createSnippet.isPending}>
                {createSnippet.isPending ? "Saving…" : "Save Snippet"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              {search ? "No snippets match your search" : "No snippets yet accept AI suggestions to save patterns"}
            </p>
          )}
          {filtered.map((snippet) => (
            <div key={snippet.id} className="rounded-lg border border-border/50 p-2.5 space-y-1.5 bg-card/50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{snippet.name}</p>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 mt-0.5">{snippet.language}</Badge>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleCopy(snippet.code)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(snippet.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {snippet.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {snippet.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground">
                      <Tag className="h-2 w-2" />{tag}
                    </span>
                  ))}
                </div>
              )}
              <pre className="text-[10px] text-muted-foreground bg-muted/50 rounded p-1.5 overflow-hidden max-h-[60px] font-mono">
                {snippet.code.split("\n").slice(0, 3).join("\n")}
                {snippet.code.split("\n").length > 3 && "\n…"}
              </pre>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
