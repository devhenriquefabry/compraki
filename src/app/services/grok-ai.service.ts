import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ChatMessage } from '../interfaces/chat';

@Injectable({
  providedIn: 'root'
})
export class GrokAiService {

  private apiUrl = 'http://localhost:3001/ai/chat';

  constructor(private http: HttpClient) { }

  /**
   * Envia o histórico do chat para o bot-server, que atua como proxy para a API do Grok.
   * A IA responde como o vendedor do produto de forma humana e inteligente.
   */
  async simulateSellerResponse(
    chatHistory: ChatMessage[], 
    productName: string, 
    currentUserId: string,
    productDescription: string = ''
  ): Promise<string> {
    try {
      // Mapeia o histórico para o formato que a API de Chat espera (role/content)
      // Limitamos as últimas 10 mensagens para contexto
      const messages = chatHistory.slice(-10).map(msg => {
        return {
          role: msg.senderId === currentUserId ? 'user' : 'assistant',
          content: msg.text || (msg.type === 'image' ? '[Imagem enviada]' : '[Áudio enviado]')
        };
      });

      // Faz a chamada para o nosso proxy no backend
      const response: any = await firstValueFrom(
        this.http.post(this.apiUrl, {
          messages,
          productName,
          productDescription
        })
      );

      // Retorna o conteúdo da mensagem da IA
      if (response && response.choices && response.choices.length > 0) {
        return response.choices[0].message.content;
      }

      return "Opa, tive um probleminha aqui pra processar sua mensagem. Pode repetir?";

    } catch (error) {
      console.error("Erro ao chamar IA do Grok no Servidor:", error);
      return "Estou com um pouco de instabilidade na minha conexão agora, mas pode me perguntar qualquer coisa sobre o produto!";
    }
  }
}
