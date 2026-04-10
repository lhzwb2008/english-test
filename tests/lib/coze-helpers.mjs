import { ChatEventType } from '@coze/api';

/**
 * 含音频输入时必须走流式 Chat（stream=true），不能用 createAndPoll。
 * 消费流直到 conversation.chat.completed，再拉取消息列表。
 */
export async function streamChatThenListMessages(client, params) {
  let conversationId;
  let chatId;
  for await (const evt of client.chat.stream(params)) {
    if (evt.event === ChatEventType.ERROR) {
      const err = evt.data;
      throw new Error(
        typeof err === 'object' && err?.msg
          ? err.msg
          : JSON.stringify(err)
      );
    }
    if (evt.event === ChatEventType.CONVERSATION_CHAT_COMPLETED) {
      conversationId = evt.data.conversation_id;
      chatId = evt.data.id;
    }
  }
  if (!conversationId || !chatId) {
    throw new Error('流结束但未收到 conversation.chat.completed');
  }
  return client.chat.messages.list(conversationId, chatId);
}
