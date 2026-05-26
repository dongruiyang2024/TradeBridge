export function buildPayload(
  conversation: Record<string, unknown>,
  bootstrap: Record<string, string>,
  before: number | null,
  pageSize: number
): Record<string, unknown> {
  return {
    contactAccountId: conversation.contactAccountId,
    contactAccountIdEncrypt: conversation.encryptContactAccountId ?? conversation.contactAccountIdEncrypt,
    aliId: conversation.contactAliId,
    aliIdEncrypt: conversation.encryptContactAliId ?? conversation.aliIdEncrypt,
    cid: conversation.cid,
    conversationCode: conversation.cid,
    chatToken: conversation.chatToken,
    selfAliId: conversation.selfAliId ?? bootstrap.aliId,
    timeSlide: {
      forward: false,
      timeStamp: before,
      pageSize
    }
  };
}
