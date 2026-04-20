const axios = require('axios');
const config = require('../automation-config');

/**
 * Utilitário para interagir com a API do Groq (Grok/Llama 3).
 */
class LLMHelper {
    
    constructor() {
        this.apiKey = config.groqApiKey;
        this.model = config.defaultModel;
        this.endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    }

    async getCompletion(prompt, systemPrompt = 'Você é um assistente criativo para um marketplace brasileiro chamado Compraki.') {
        if (!this.apiKey) return null;

        try {
            const response = await axios.post(this.endpoint, {
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.choices[0].message.content.trim();
        } catch (error) {
            console.error('[LLM-Helper] Erro na chamada ao Groq:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Gera uma palavra-chave criativa para pesquisa de produtos USADOS.
     * Focado em variedade extrema e itens inusitados.
     */
    async generateCreativeKeyword() {
        const prompt = `Sugira UM item MODERNO e popular que seja comumente vendido como USADO no Brasil. 
           Pense em categorias como: Tecnologia (celulares, tablets), Eletroportáteis (Air Fryers, Cafeteiras), 
           Equipamentos Fitness, Moda de Marca ou Acessórios de Carro.
           Retorne APENAS o nome do produto, sem explicações.`;
           
        const result = await this.getCompletion(prompt);
        return result || 'Smartphone'; // Fallback
    }

    /**
     * Gera um perfil de usuário realista com endereço completo para preenchimento manual.
     */
    async generateCreativeUser() {
        const prompt = `Gere um perfil de uma pessoa brasileira real (homem ou mulher). 
           Inclua um endereço residencial DETALHADO em alguma cidade num raio de 100km de Manhuaçu-MG.
           Retorne no formato JSON: {"name": "Nome", "cep": "36900000", "street": "Rua Exemplo", "neighborhood": "Bairro Exemplo", "city": "Cidade", "state": "MG"}.`;
           
        const result = await this.getCompletion(prompt, 'Você é um gerador de identidades brasileiras realistas com endereços completos. Retorne APENAS JSON.');
        try {
            return JSON.parse(result.replace(/```json|```/g, ''));
        } catch (e) {
            return null;
        }
    }

    /**
     * Analisa um erro e sugere uma ação corretiva.
     */
    async analyzeError(errorMessage, stepContext) {
        const prompt = `O robô falhou na etapa "${stepContext}" com o erro: "${errorMessage}".
           Baseado nisso, o que o robô deve fazer? (Ex: tentar novamente mudando o dado, esperar mais tempo, ou pular o produto).
           Responda de forma curta e objetiva.`;
           
        return await this.getCompletion(prompt, 'Você é um engenheiro de QA especialista em automação Puppeteer e Angular.');
    }
}

module.exports = new LLMHelper();
