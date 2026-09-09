import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from './constants';

export function slotPda(owner: PublicKey, index: number): [PublicKey, number] {
  const indexBytes = Buffer.alloc(2);
  indexBytes.writeUInt16LE(index, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('slot'), owner.toBuffer(), indexBytes],
    PROGRAM_ID,
  );
}

export function vaultPda(slot: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), slot.toBuffer()],
    PROGRAM_ID,
  );
}
