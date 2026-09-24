/**
 * Preparação do Firebase antes do bootstrap do Angular.
 *
 * Neste build não faz nada. No build `emulator` (npm run start:emulator) este
 * arquivo é trocado por `emulator-bootstrap.emulator.ts` via `fileReplacements`
 * em angular.json — é assim que o login de teste fica FORA do bundle de
 * produção, em vez de depender de um `if` que alguém pode desligar.
 */
export async function prepareFirebase(): Promise<void> {}
