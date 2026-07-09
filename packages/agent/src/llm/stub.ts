import type { ChatMessage, ChatProvider } from './types';

/**
 * 离线确定性桩(无需 key,供开发与单测)。
 * 返回合法的 JSON(与管道期望的 {coverageDirection, rationale, keyClauses} 一致),
 * 并从 user 消息里回读险种名,使输出可辨识。不代表真实生成质量。
 */
export class StubChatProvider implements ChatProvider {
  readonly id = 'stub';
  readonly model = 'stub-chat';

  async complete(messages: ChatMessage[]): Promise<string> {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    const m = /险种[:：]\s*([^\n]+)/.exec(user);
    const line = (m ? m[1] : '该险种').trim();
    return JSON.stringify({
      coverageDirection: `[stub] ${line}的主流承保方向与保障结构`,
      rationale: `[stub] 结合企业画像与检索到的条款证据,建议配置${line}`,
      keyClauses: [`[stub] ${line}关键条款要点(摘自证据)`],
    });
  }
}
