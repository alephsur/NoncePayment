import {
  Connection,
  Keypair,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

/**
 * Instrucciones para crear e inicializar un durable nonce account.
 *
 * La nonce authority es la CLAVE DE DISPOSITIVO, no la wallet del usuario: es la que
 * tiene que poder firmar sin red y sin abrir la app de wallet.
 */
export async function createNonceAccountInstructions(
  connection: Connection,
  payer: PublicKey,
  nonceKeypair: Keypair,
  nonceAuthority: PublicKey,
): Promise<TransactionInstruction[]> {
  const lamports = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH,
  );

  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: nonceKeypair.publicKey,
      lamports,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SystemProgram.programId,
    }),
    SystemProgram.nonceInitialize({
      noncePubkey: nonceKeypair.publicKey,
      authorizedPubkey: nonceAuthority,
    }),
  ];
}

/**
 * Lee el blockhash almacenado en un nonce account.
 *
 * Este valor es lo que se cachea en el movil y se usa como `recentBlockhash` al firmar
 * offline. No caduca. Solo cambia cuando alguien avanza el nonce, cosa que ocurre
 * exactamente una vez: al canjear el billete.
 */
export async function readNonceValue(
  connection: Connection,
  noncePubkey: PublicKey,
): Promise<string> {
  const info = await connection.getAccountInfo(noncePubkey, 'confirmed');
  if (!info) throw new Error(`Nonce account no encontrado: ${noncePubkey.toBase58()}`);
  return NonceAccount.fromAccountData(info.data).nonce;
}

/** Renta necesaria por nonce account. Util para mostrar el coste real al usuario. */
export function nonceRentLamports(connection: Connection): Promise<number> {
  return connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
}
