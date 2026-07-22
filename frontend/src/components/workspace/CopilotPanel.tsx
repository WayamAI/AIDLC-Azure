import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, Bookmark, FlaskConical } from "lucide-react";
import { CopilotChat } from "./CopilotChat";
import { SnippetLibrary } from "./SnippetLibrary";
import { TestGenerator } from "./TestGenerator";

export function CopilotPanel() {
  return (
    <div className="h-full flex flex-col border-l border-border/50">
      <Tabs defaultValue="chat" className="flex flex-col h-full">
        <TabsList className="w-full rounded-none border-b border-border/50 bg-muted/20 h-9 flex-shrink-0 justify-start px-1">
          <TabsTrigger value="chat" className="h-7 text-xs px-2 data-[state=active]:bg-background">
            <MessageSquare className="h-3 w-3 mr-1" />
            Copilot
          </TabsTrigger>
          <TabsTrigger value="tests" className="h-7 text-xs px-2 data-[state=active]:bg-background">
            <FlaskConical className="h-3 w-3 mr-1" />
            Tests
          </TabsTrigger>
          <TabsTrigger value="snippets" className="h-7 text-xs px-2 data-[state=active]:bg-background">
            <Bookmark className="h-3 w-3 mr-1" />
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
