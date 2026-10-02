import crypto from 'crypto';

export interface MerkleStep {
  siblingHashHex: string;
  isRight: boolean;
}

export interface MerkleProof {
  path: MerkleStep[];
  peakIdx: number;
  otherPeaksHex: string[];
}

export class MerkleNode {
  hash: Buffer;
  height: number;
  left: MerkleNode | null;
  right: MerkleNode | null;
  parent: MerkleNode | null;

  constructor(hash: Buffer, height = 0, left: MerkleNode | null = null, right: MerkleNode | null = null) {
    this.hash = hash;
    this.height = height;
    this.left = left;
    this.right = right;
    this.parent = null;
  }
}

export function hashLeaf(leaf: string): Buffer {
  return crypto.createHash('sha256').update(Buffer.from(leaf, 'utf-8')).digest();
}

export function hashPair(left: Buffer, right: Buffer): Buffer {
  return crypto.createHash('sha256').update(Buffer.concat([left, right])).digest();
}

