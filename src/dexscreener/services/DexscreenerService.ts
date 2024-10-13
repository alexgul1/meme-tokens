import * as Sentry from '@sentry/node';
import {Cache, CacheClass} from 'memory-cache'

import {ITokenPairs} from './ITokenPairs';
import {IPair} from './IPair';

export class DexscreenerService {
	private static SOLAddress = 'So11111111111111111111111111111111111111112';
	private static addressToPairsCache: CacheClass<string, ITokenPairs> = new Cache()

	static async getTokenInfo(pairAddress: string): Promise<ITokenPairs|null> {
		try {
			const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
			const data = await response.json();

			return data as ITokenPairs;

		} catch (error) {
			Sentry.captureException({message: 'Error fetching token info from Dexscreener', error});

			console.error('Error fetching token info from Dexscreener:', error);
			return null;
		}
	}

	static async getTokenPairsByAddress(tokenAddress: string): Promise<ITokenPairs|null> {
		try {
			const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);

			return await response.json() as ITokenPairs;
		} catch (error) {
			Sentry.captureException({message: 'Error fetching token info from Dexscreener', error});

			console.error('Error fetching token info from Dexscreener:', error);
			return null;
		}
	}

	static async searchTokenByAddress(tokenAddress: string): Promise<ITokenPairs|null> {
		try {
			const inCacheResponse = this.addressToPairsCache.get(tokenAddress)

			if (inCacheResponse) {
				return inCacheResponse
			}

			const response = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${tokenAddress}`);

			if (response.ok) {
				const data = await response.json() as ITokenPairs;

				if (data?.pairs.length) {
					this.addressToPairsCache.put(tokenAddress, data);
				}

				return data
			}

			return null;
		} catch (error) {
			Sentry.captureException({message: 'Error fetching token info from Dexscreener', error});

			console.error('Error fetching token info from Dexscreener:', error);
			return null;
		}
	}

	static async getTokenPair(tokenAddress: string): Promise<unknown>{
		const tokenPairs = await this.getTokenPairsByAddress(tokenAddress);

		if (!tokenPairs?.pairs) {
			return
		}

		return tokenPairs.pairs.find((pair)=> this.isTokenSolPairOnRaydium(pair))
	}

	static async getTokenByPair(pairAddress: string):Promise<unknown>{
		const pairs = await this.getTokenInfo(pairAddress)

		if (!pairs?.pairs) {
			return
		}

		return pairs.pairs.find((pair)=> this.isTokenSolPairOnRaydium(pair))
	}

	private static isTokenSolPairOnRaydium(pair: IPair) {
		return pair.chainId === 'solana' && pair.dexId === 'raydium' &&
			(pair.baseToken.address === this.SOLAddress || pair.quoteToken.address === this.SOLAddress) && (pair.liquidity?.usd && pair.liquidity?.usd > 3000)
	}


	static async getTokenFromSearch(address: string):Promise<IPair|undefined>{
		const pairs = await this.searchTokenByAddress(address)

		if (!pairs?.pairs) {
			return
		}

		return pairs.pairs.find((pair)=> this.isTokenSolPairOnRaydium(pair))
	}
}
