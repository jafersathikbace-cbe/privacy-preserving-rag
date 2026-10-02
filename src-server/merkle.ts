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

export function buildMerkleTree(leaves: string[]): {
  rootHash: Buffer | null;
  rootHashHex: string;
  proofs: MerkleProof[];
} {
  if (!leaves || leaves.length === 0) {
    return { rootHash: null, rootHashHex: '', proofs: [] };
  }

  const stack: MerkleNode[] = [];
  for (const leaf of leaves) {
    let node = new MerkleNode(hashLeaf(leaf), 0);
    while (stack.length >= 1 && stack[stack.length - 1].height === node.height) {
      const older = stack.pop()!;
      const parent = new MerkleNode(
        hashPair(older.hash, node.hash),
        older.height + 1,
        older,
        node
      );
      older.parent = parent;
      node.parent = parent;
      node = parent;
    }
    stack.push(node);
  }

  const peakHashes = stack.map((peak) => peak.hash);
  let globalRoot: Buffer;
  if (peakHashes.length === 1) {
    globalRoot = peakHashes[0];
  } else {
    globalRoot = crypto.createHash('sha256').update(Buffer.concat(peakHashes)).digest();
  }

  // Build leaf to node map
  const leafHashToNode = new Map<string, MerkleNode>();
  for (const peak of stack) {
    const nodes: MerkleNode[] = [peak];
    while (nodes.length > 0) {
      const node = nodes.pop()!;
      if (!node.left && !node.right) {
        leafHashToNode.set(node.hash.toString('hex'), node);
      } else {
        if (node.left) nodes.push(node.left);
        if (node.right) nodes.push(node.right);
      }
    }
  }

  // Map each leaf node to its peak
  const leafToPeak = new Map<string, { peak: MerkleNode; idx: number }>();
  for (let idx = 0; idx < stack.length; idx++) {
    const peak = stack[idx];
    const nodes: MerkleNode[] = [peak];
    while (nodes.length > 0) {
      const node = nodes.pop()!;
      if (!node.left && !node.right) {
        leafToPeak.set(node.hash.toString('hex'), { peak, idx });
      } else {
        if (node.left) nodes.push(node.left);
        if (node.right) nodes.push(node.right);
      }
    }
  }

  const proofs: MerkleProof[] = [];
  for (const leaf of leaves) {
    const leafHash = hashLeaf(leaf);
    const leafHashHex = leafHash.toString('hex');
    const node = leafHashToNode.get(leafHashHex);
    if (!node) {
      proofs.push({ path: [], peakIdx: 0, otherPeaksHex: [] });
      continue;
    }

    const path: MerkleStep[] = [];
    let current = node;
    while (current.parent !== null) {
      const parent = current.parent;
      let sibling: MerkleNode;
      let isRight: boolean;
      if (parent.left === current) {
        sibling = parent.right!;
        isRight = true;
      } else {
        sibling = parent.left!;
        isRight = false;
      }
      path.push({ siblingHashHex: sibling.hash.toString('hex'), isRight });
      current = parent;
    }

    const peakInfo = leafToPeak.get(leafHashHex);
    const peakIdx = peakInfo ? peakInfo.idx : 0;
    const otherPeaksHex = stack
      .filter((_, i) => i !== peakIdx)
      .map((p) => p.hash.toString('hex'));

    proofs.push({ path, peakIdx, otherPeaksHex });
  }

  return { rootHash: globalRoot, rootHashHex: globalRoot.toString('hex'), proofs };
}

export function verifyMerkleProof(
  leaf: string,
  proof: MerkleProof,
  rootHashHex: string
): boolean {
  if (!proof || !rootHashHex) return false;

  let current = hashLeaf(leaf);
  for (const step of proof.path) {
    const sibling = Buffer.from(step.siblingHashHex, 'hex');
    if (step.isRight) {
      current = hashPair(current, sibling);
    } else {
      current = hashPair(sibling, current);
    }
  }

  const peaks: Buffer[] = proof.otherPeaksHex.map((hex) => Buffer.from(hex, 'hex'));
  peaks.splice(proof.peakIdx, 0, current as Buffer);

  let computedRoot: Buffer;
  if (peaks.length === 1) {
    computedRoot = peaks[0];
  } else {
    computedRoot = crypto.createHash('sha256').update(Buffer.concat(peaks)).digest();
  }

  return computedRoot.toString('hex') === rootHashHex;
}
