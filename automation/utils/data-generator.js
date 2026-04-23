const { fakerPT_BR: faker } = require('@faker-js/faker');
const llmHelper = require('./llm-helper');

/**
 * Gera dados realistas para automação no Brasil via IA.
 */
async function generateUserData() {
    // Busca um perfil completo na IA (Nome, CEP, Endereço)
    const aiProfile = await llmHelper.generateCreativeUser();
    
    // Fallback qualificado se a IA falhar ou retornar incompleto
    const name = aiProfile?.name || faker.person.fullName();
    const cep = aiProfile?.cep?.replace(/\D/g, '') || '36900000';
    
    return {
        name: name,
        email: faker.internet.email().toLowerCase(),
        cpf: faker.number.int({ min: 10000000000, max: 99999999999 }).toString(),
        phone: '339' + faker.number.int({ min: 80000000, max: 99999999 }).toString(), // DDD da região
        password: 'Password123!',
        cep: cep,
        street: aiProfile?.street || faker.location.street(),
        neighborhood: aiProfile?.neighborhood || 'Centro',
        city: aiProfile?.city || 'Manhuaçu',
        state: aiProfile?.state || 'MG',
        complement: 'Casa'
    };
}

module.exports = { generateUserData };
