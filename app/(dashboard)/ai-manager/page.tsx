import { ConversationProvider } from "@/components/dashboard/ai-manager/conversation-provider";
import { ModernChatLayout } from "@/components/dashboard/ai-manager/modern-chat-layout";

const AiAgentPage = () => {
  return (
    <ConversationProvider>
      <ModernChatLayout />
    </ConversationProvider>
  );
};

export default AiAgentPage;
