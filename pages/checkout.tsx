import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Keypair, Transaction, TransactionSignature } from "@solana/web3.js";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import BackLink from "../components/BackLink";
import Loading from "../components/Loading";
import { MakeTransactionInputData, MakeTransactionOutputData } from "../api/makeTransaction";

// Utility to fetch transaction signature (not available in solana/web3.js directly)
async function findTransactionSignature(connection: any, reference: Keypair) {
  // Implement the logic to find the transaction signature
  // This is a placeholder; you'll need to replace this with actual implementation
}

export default function Checkout() {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(router.query)) {
    if (value) {
      if (Array.isArray(value)) {
        for (const v of value) {
          searchParams.append(key, v);
        }
      } else {
        searchParams.append(key, value);
      }
    }
  }

  const reference = useMemo(() => Keypair.generate(), []);
  searchParams.append('reference', reference.publicKey.toString());

  async function getTransaction() {
    if (!publicKey) return;

    const body: MakeTransactionInputData = { account: publicKey.toString() };

    const response = await fetch(`/api/makeTransaction?${searchParams.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await response.json() as MakeTransactionOutputData;

    if (response.status !== 200) {
      console.error(json);
      return;
    }

    const transaction = Transaction.from(Buffer.from(json.transaction, 'base64'));
    setTransaction(transaction);
    setMessage(json.message);
  }

  useEffect(() => {
    getTransaction();
  }, [publicKey]);

  async function trySendTransaction() {
    if (!transaction) return;

    try {
      const signature = await sendTransaction(transaction, connection);
      console.log('Transaction sent with signature:', signature);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (transaction) {
      trySendTransaction();
    }
  }, [transaction]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // Placeholder for checking transaction signature
        await findTransactionSignature(connection, reference);
        router.push('/confirmed');
      } catch (e) {
        console.error('Error checking transaction:', e);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  if (!publicKey) {
    return (
      <div className='flex flex-col gap-8 items-center'>
        <div><BackLink href='/buy'>Cancel</BackLink></div>
        <WalletMultiButton />
        <p>You need to connect your wallet to make transactions</p>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-8 items-center'>
      <div><BackLink href='/buy'>Cancel</BackLink></div>
      <WalletMultiButton />
      {message
        ? <p>{message} Please approve the transaction using your wallet</p>
        : <p>Creating transaction... <Loading /></p>
      }
    </div>
  );
}
