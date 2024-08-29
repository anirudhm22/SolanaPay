import { createTransferCheckedInstruction, getAssociatedTokenAddress, getMint, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { NextApiRequest, NextApiResponse } from "next";
import { couponAddress, shopAddress, usdcAddress } from "../../lib/addresses";
import calculatePrice from "../../lib/calculatePrice";
import base58 from 'bs58';
import baseX from 'base-x';

export type MakeTransactionInputData = {
  account: string,
}

type MakeTransactionGetResponse = {
  label: string,
  icon: string,
}

export type MakeTransactionOutputData = {
  transaction: string,
  message: string,
}

type ErrorOutput = {
  error: string
}

const get = (res: NextApiResponse<MakeTransactionGetResponse>) => {
  res.status(200).json({
    label: "Cookies Inc",
    icon: "https://freesvg.org/img/1370962427.png",
  });
}

const post = async (
  req: NextApiRequest,
  res: NextApiResponse<MakeTransactionOutputData | ErrorOutput>
) => {
  try {
    // Validate and calculate amount
    const amount = calculatePrice(req.query);
    if (amount.toNumber() === 0) {
      return res.status(400).json({ error: "Can't checkout with a charge of 0" });
    }

    const { reference } = req.query;
    if (!reference) {
      return res.status(400).json({ error: "No reference provided" });
    }

    const { account } = req.body as MakeTransactionInputData;
    if (!account) {
      return res.status(400).json({ error: "No account provided" });
    }

    // Load shop keypair
    const shopPrivateKey = process.env.SHOP_PRIVATE_KEY;
    if (!shopPrivateKey) {
      return res.status(500).json({ error: "Shop private key not available" });
    }
    const shopKeypair = Keypair.fromSecretKey(base58.decode(shopPrivateKey));

    const buyerPublicKey = new PublicKey(account);
    const shopPublicKey = shopKeypair.publicKey;

    const network = WalletAdapterNetwork.Devnet;
    const endpoint = clusterApiUrl(network);
    const connection = new Connection(endpoint);

    // Get or create buyer's coupon account
    const buyerCouponAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      shopKeypair, // shop pays the fee
      couponAddress,
      buyerPublicKey
    );

    const shopCouponAddress = await getAssociatedTokenAddress(couponAddress, shopPublicKey);

    // Check coupon discount eligibility
    const buyerGetsCouponDiscount = Number(buyerCouponAccount.amount) >= 5;

    // Get USDC token details and addresses
    const usdcMint = await getMint(connection, usdcAddress);
    const buyerUsdcAddress = await getAssociatedTokenAddress(usdcAddress, buyerPublicKey);
    const shopUsdcAddress = await getAssociatedTokenAddress(usdcAddress, shopPublicKey);

    // Create transaction
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    const transaction = new Transaction({
      recentBlockhash: blockhash,
      feePayer: buyerPublicKey,
    });

    // Calculate amount to pay
    const amountToPay = buyerGetsCouponDiscount ? amount.dividedBy(2) : amount;

    // Create transfer instructions
    const transferInstruction = createTransferCheckedInstruction(
      buyerUsdcAddress,
      usdcAddress,
      shopUsdcAddress,
      buyerPublicKey,
      amountToPay.toNumber() * (10 ** usdcMint.decimals),
      usdcMint.decimals
    );

    transferInstruction.keys.push({
      pubkey: new PublicKey(reference),
      isSigner: false,
      isWritable: false,
    });

    const couponInstruction = buyerGetsCouponDiscount ?
      createTransferCheckedInstruction(
        buyerCouponAccount.address,
        couponAddress,
        shopCouponAddress,
        buyerPublicKey,
        5,
        0
      ) :
      createTransferCheckedInstruction(
        shopCouponAddress,
        couponAddress,
        buyerCouponAccount.address,
        shopPublicKey,
        1,
        0
      );

    couponInstruction.keys.push({
      pubkey: shopPublicKey,
      isSigner: true,
      isWritable: false,
    });

    transaction.add(transferInstruction, couponInstruction);
    transaction.partialSign(shopKeypair);

    // Serialize transaction and convert to base64
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false
    });
    const base64 = serializedTransaction.toString('base64');

    // Respond with the serialized transaction
    const message = buyerGetsCouponDiscount ? "50% Discount! 🍪" : "Thanks for your order! 🍪";
    res.status(200).json({
      transaction: base64,
      message,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating transaction' });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MakeTransactionGetResponse | MakeTransactionOutputData | ErrorOutput>
) {
  if (req.method === "GET") {
    return get(res);
  } else if (req.method === "POST") {
    return await post(req, res);
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
