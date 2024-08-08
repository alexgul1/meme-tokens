import { Connection, PublicKey } from '@solana/web3.js';

export class SolanaService {
	private static connection: Connection = new Connection('https://api.mainnet-beta.solana.com');


	static async getTokenAccountsByOwner(address: string): Promise<void> {
		try {
			const publicKey = new PublicKey(address);
			const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(publicKey, {
				programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
			});

			console.log('Token Accounts:');
			console.log(tokenAccounts)
			tokenAccounts.value.forEach((accountInfo) => {
				const mint = accountInfo.account.data.parsed.info.mint;
				const balance = accountInfo.account.data.parsed.info.tokenAmount.uiAmount;
				console.log(`- Mint: ${mint}`);
				console.log(`  Balance: ${balance}`);
			});
		} catch (error) {
			console.error('Error getting token accounts:', error);
		}
	}

	static async getTokenInfo(mintAddress: string): Promise<void> {
		try {
			const mintPublicKey = new PublicKey(mintAddress);
			const tokenInfo = await this.connection.getParsedAccountInfo(mintPublicKey);
			console.log('Token Info:', JSON.stringify(tokenInfo));
		} catch (error) {
			console.error('Error getting token info:', error);
		}
	}
}
