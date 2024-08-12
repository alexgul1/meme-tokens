import {ITokenPairs} from './ITokenPairs';
import {WebSocketService} from '../../websocket/WebSocketService';

export class DexscreenerService {
	static async getTokenInfo(pairAddress: string): Promise<ITokenPairs> {
		try {
			const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
			const data = await response.json();

			return data as ITokenPairs;

		} catch (error) {
			console.error('Error fetching token info from Dexscreener:', error);
		}
	}

	static async getTokenPairsByAddress(tokenAddress: string): Promise<ITokenPairs|null> {
		try {
			const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
			return await response.json() as ITokenPairs;
		} catch (error) {
			console.error('Error fetching token info from Dexscreener:', error);
			return null;
		}
	}

	static async getTokenPair(tokenAddress: string): Promise<unknown>{
		const tokenPairs = await this.getTokenPairsByAddress(tokenAddress);

		if (!tokenPairs?.pairs) {
			return
		}

		return tokenPairs.pairs.find((pair)=> pair.chainId === 'solana' && pair.dexId === 'raydium')
	}

	static async getTokenByPair(pairAddress: string):Promise<unknown>{
		const pairs = await this.getTokenInfo(pairAddress)

		if (!pairs?.pairs) {
			return
		}

		return pairs.pairs.find((pair)=> pair.chainId === 'solana' && pair.dexId === 'raydium')

	}

	static async subscribeToPrice(pairAddress: string): Promise<void>{
		if (!pairAddress) {
			return ;
		}

		const headers = {
			'Host': 'io.dexscreener.com',
			'Connection': 'Upgrade',
			'Pragma': 'no-cache',
			'Cache-Control': 'no-cache',
			'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			'Upgrade': 'websocket',
			'Origin': 'https://dexscreener.com',
			'Sec-WebSocket-Version': 13,
			'Accept-Encoding': 'gzip, deflate, br, zstd',
			'Accept-Language': 'en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7,uk;q=0.6',
		};


		const wsUrl =
			'wss://io.dexscreener.com/dex/screener/pairs/h24/1?rankBy[key]=trendingScoreH24&rankBy[order]=desc&filters[chainIds][0]=solana'; // Adjust URL as needed

		new WebSocketService(wsUrl, headers);
	}
}
