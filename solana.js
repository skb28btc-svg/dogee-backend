const {
  Connection, Keypair, PublicKey, clusterApiUrl
} = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  transfer,
  getMint
} = require('@solana/spl-token');
const bs58 = require('bs58');

let connection, treasuryKeypair, mintPublicKey;

function init() {
  connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  const secretKey = bs58.decode(process.env.TREASURY_PRIVATE_KEY);
  treasuryKeypair = Keypair.fromSecretKey(secretKey);
  mintPublicKey = new PublicKey(process.env.DOGEE_TOKEN_MINT);
  console.log('✅ Solana Devnet connected. Treasury:', treasuryKeypair.publicKey.toBase58());
}

async function sendDogee(recipientAddress, amount) {
  const recipient = new PublicKey(recipientAddress);
  const mint = await getMint(connection, mintPublicKey);
  const decimals = mint.decimals;
  const rawAmount = BigInt(Math.round(amount * Math.pow(10, decimals)));

  // Get/create treasury token account
  const treasuryATA = await getOrCreateAssociatedTokenAccount(
    connection, treasuryKeypair, mintPublicKey, treasuryKeypair.publicKey
  );

  // Get/create recipient token account
  const recipientATA = await getOrCreateAssociatedTokenAccount(
    connection, treasuryKeypair, mintPublicKey, recipient
  );

  // Transfer
  const txHash = await transfer(
    connection,
    treasuryKeypair,
    treasuryATA.address,
    recipientATA.address,
    treasuryKeypair,
    rawAmount
  );

  return txHash;
}

async function getTreasuryBalance() {
  try {
    const { getAssociatedTokenAddress, getAccount } = require('@solana/spl-token');
    const ata = await getAssociatedTokenAddress(mintPublicKey, treasuryKeypair.publicKey);
    const account = await getAccount(connection, ata);
    const mint = await getMint(connection, mintPublicKey);
    return Number(account.amount) / Math.pow(10, mint.decimals);
  } catch {
    return 0;
  }
}

async function getSolBalance() {
  const lamports = await connection.getBalance(treasuryKeypair.publicKey);
  return lamports / 1e9;
}

module.exports = { init, sendDogee, getTreasuryBalance, getSolBalance };
