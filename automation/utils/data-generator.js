const { fakerPT_BR: faker } = require('@faker-js/faker');
const llmHelper = require('./llm-helper');

/**
 * Gera dados realistas para automação no Brasil via IA.
 */
async function generateUserData() {
    // Busca um perfil completo na IA (Nome, CEP, Endereço)
    const aiProfile = await llmHelper.generateCreativeUser();
    
    // Fallback básico se a IA falhar
    const name = aiProfile?.name || faker.person.fullName();
    const cep = aiProfile?.cep?.replace(/\D/g, '') || '36900000';
    
    return {
        name: name,
        email: faker.internet.email().toLowerCase(),
        cpf: faker.number.int({ min: 10000000000, max: 99999999999 }).toString(), // 11 dígitos limpos
        phone: '119' + faker.number.int({ min: 10000000, max: 99999999 }).toString(), // Celular simplificado
        password: 'Password123!',
        cep: cep,
        street: aiProfile?.street,
        neighborhood: aiProfile?.neighborhood,
        city: aiProfile?.city,
        state: aiProfile?.state || 'MG'
    };
}

module.exports = { generateUserData };
