export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompleteOptions {
  temperature?: number;
}

/** 对话补全后端(OpenAI / stub 可插拔) */
export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  complete(messages: ChatMessage[], opts?: ChatCompleteOptions): Promise<string>;
}
