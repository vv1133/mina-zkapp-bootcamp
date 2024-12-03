import { Field, Mina, AccountUpdate, Bool, MerkleTree } from "o1js";

import { VotingCounter, TeamMemberWitness } from "./VotingCounter.js";
import { sha256 } from "js-sha256";

describe("VotingCounter Test", () => {
  // 测试总览
  // 未设置root,直接投票
  // 更新root
  // 无权限者更新root
  // 投赞成票
  // 投反对票
  // 非成员投票

  let members: string[];
  let tree: MerkleTree;
  let memberHashes: Field[];

  let sender: Mina.TestPublicKey;
  let other: Mina.TestPublicKey;
  let zkappAccount: Mina.TestPublicKey;
  let zkapp: VotingCounter;

  beforeEach(async () => {
    // 创建团队MerkleTree
    members = ["Alice", "Bob", "Charlie", "Dave"];
    // let treeHeight = Math.ceil(Math.log2(members.length + 1));
    const treeHeight = 20;
    tree = new MerkleTree(treeHeight);

    // 用名字转哈希数组
    memberHashes = members.map((name) => {
      const hash = sha256.create();
      hash.update(name);
      const hashBigInt = BigInt("0x" + hash.hex());
      return Field(hashBigInt);
    });

    // 设置到Merkle Tree里
    memberHashes.forEach((hash, index) => {
      tree.setLeaf(BigInt(index), hash);
    });

    // ---------------------------------------

    const doProofs = false;
    let Local = await Mina.LocalBlockchain({ proofsEnabled: doProofs });
    Mina.setActiveInstance(Local);

    if (doProofs) {
      await VotingCounter.compile();
    } else {
      await VotingCounter.analyzeMethods();
    }

    [sender, other] = Local.testAccounts;

    zkappAccount = Mina.TestPublicKey.random();
    zkapp = new VotingCounter(zkappAccount);

    // 部署合约
    const tx = await Mina.transaction(sender, async () => {
      AccountUpdate.fundNewAccount(sender);
      await zkapp.deploy();
    });
    await tx.prove();
    await tx.sign([sender.key, zkappAccount.key]).send();
  });

  async function updateTeam() {
    const tx = await Mina.transaction(sender, async () => {
      await zkapp.setTeam(tree.getRoot());
    });
    await tx.prove();
    await tx.sign([sender.key, zkappAccount.key]).send();
  }

  it("未设置root,直接投票.", async () => {
    const aliceIndex = 0;
    const aliceWitness = new TeamMemberWitness(
      tree.getWitness(BigInt(aliceIndex))
    );

    // 预期会发生错误
    await expect(async () => {
      const tx = await Mina.transaction(sender, async () => {
        await zkapp.vote(Bool(true), memberHashes[aliceIndex], aliceWitness);
      });
      await tx.prove();
      await tx.sign([sender.key, zkappAccount.key]).send();
    }).rejects.toThrow("Root not set");

    console.log("MerkleRoot: " + zkapp.merkleRoot.get().toString());
    console.log("Approve votes: " + zkapp.approveVotes.get().toString());
    console.log("Reject votes: " + zkapp.rejectVotes.get().toString());

    expect(zkapp.merkleRoot.get()).toEqual(Field(0));
    expect(zkapp.approveVotes.get()).toEqual(Field(0));
    expect(zkapp.rejectVotes.get()).toEqual(Field(0));
  });

  it("无权限者更新root", async () => {
    // other调用setTeam

    // 预期会发生错误
    await expect(async () => {
      const tx = await Mina.transaction(other, async () => {
        await zkapp.setTeam(tree.getRoot());
      });
      await tx.prove();
      await tx.sign([other.key, zkappAccount.key]).send();
    }).rejects.toThrow("Not deployer");

    console.log("MerkleRoot: " + zkapp.merkleRoot.get().toString());
    expect(zkapp.merkleRoot.get()).toEqual(Field(0));
  });

  it("投赞成票", async () => {
    await updateTeam();

    const aliceIndex = 0;
    const aliceWitness = new TeamMemberWitness(
      tree.getWitness(BigInt(aliceIndex))
    );
    const tx = await Mina.transaction(sender, async () => {
      await zkapp.vote(Bool(true), memberHashes[aliceIndex], aliceWitness);
    });
    await tx.prove();
    await tx.sign([sender.key, zkappAccount.key]).send();

    console.log("投赞成票ing");
    console.log("Approve votes: " + zkapp.approveVotes.get().toString());
    console.log("Reject votes: " + zkapp.rejectVotes.get().toString());
    expect(zkapp.merkleRoot.get()).toEqual(tree.getRoot());
    expect(zkapp.approveVotes.get()).toEqual(Field(1));
    expect(zkapp.rejectVotes.get()).toEqual(Field(0));
  });

  it("投反对票", async () => {
    await updateTeam();
    const bobIndex = 1;
    const bobWitness = new TeamMemberWitness(tree.getWitness(BigInt(bobIndex)));

    const tx = await Mina.transaction(sender, async () => {
      await zkapp.vote(Bool(false), memberHashes[bobIndex], bobWitness);
    });
    await tx.prove();
    await tx.sign([sender.key, zkappAccount.key]).send();

    console.log("投反对票ing");
    console.log("Approve votes: " + zkapp.approveVotes.get().toString());
    console.log("Reject votes: " + zkapp.rejectVotes.get().toString());
    expect(zkapp.merkleRoot.get()).toEqual(tree.getRoot());
    expect(zkapp.approveVotes.get()).toEqual(Field(0));
    expect(zkapp.rejectVotes.get()).toEqual(Field(1));
  });

  it("伪装成员投票.", async () => {
    await updateTeam();

    const beforeTreeRoot = tree.getRoot();

    // MerkleTree被非法修改
    async function creatHash(name: string): Promise<Field> {
      const hash = sha256.create();
      hash.update(name);
      const hashBigInt = BigInt("0x" + hash.hex());
      return Field(hashBigInt);
    }
    const fakerHash = await creatHash("Faker");
    tree.setLeaf(BigInt(1), fakerHash);
    const fakerWitness = new TeamMemberWitness(tree.getWitness(BigInt(1)));

    console.log("Faker Hash: " + fakerHash.toString());
    console.log("Faker proof: " + fakerWitness.toString());

    console.log("发起投票");

    // 预期会发生错误
    await expect(async () => {
      const tx = await Mina.transaction(sender, async () => {
        await zkapp.vote(Bool(true), fakerHash, fakerWitness);
      });
      await tx.prove();
      await tx.sign([sender.key, zkappAccount.key]).send();
    }).rejects.toThrow("Fake member");

    console.log("Approve votes: " + zkapp.approveVotes.get().toString());
    console.log("Reject votes: " + zkapp.rejectVotes.get().toString());

    expect(zkapp.merkleRoot.get()).toEqual(beforeTreeRoot);
    expect(zkapp.approveVotes.get()).toEqual(Field(0));
    expect(zkapp.rejectVotes.get()).toEqual(Field(0));
  });
});