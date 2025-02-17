import {ethers} from 'ethers';

// ABI для V2 (PancakeSwap)
const PANCAKESWAP_V2_PAIR_ABI = [
	'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
];

// ABI для V3 (PancakeSwap)
const PANCAKESWAP_V3_POOL_ABI = [
	'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];

type PriceUpdateCallback = (price: number) => void;

export class BSCService {
	private static provider: ethers.WebSocketProvider;
	private static callbacks: Map<string, PriceUpdateCallback> = new Map();
	private static versionMap: Map<string, 'V2' | 'V3'> = new Map();
	private static lastProcessedBlock: Map<string, number> = new Map();

	public static initialize(rpcUrl: string) {
		this.provider = new ethers.WebSocketProvider(rpcUrl);
	}

	public static async subscribeToPriceUpdates(pairAddress: string, callback: PriceUpdateCallback): Promise<void> {
		const lowerCasePair = pairAddress.toLowerCase();

		if (this.callbacks.has(lowerCasePair)) {
			console.log(`Already subscribed to pair ${lowerCasePair}`);
			return;
		}

		this.callbacks.set(lowerCasePair, callback);
		const version = await this.detectVersion(lowerCasePair);
		if (!version) {
			console.error('❌ Pool type not recognized!');
			return;
		}

		this.versionMap.set(lowerCasePair, version);
		await this.getInitialPoolState(lowerCasePair);
		this.subscribeToSwaps(lowerCasePair, version);
	}

	public static async unsubscribeFromPriceUpdates(pairAddress: string): Promise<void> {
		const lowerCasePair = pairAddress.toLowerCase();

		if (this.callbacks.has(lowerCasePair)) {
			this.callbacks.delete(lowerCasePair);
			this.lastProcessedBlock.delete(lowerCasePair);
			this.provider.off({ address: pairAddress })
			console.log(`Unsubscribed from pair ${lowerCasePair}`);
		} else {
			console.log(`No active subscription found for pair ${lowerCasePair}`);
		}
	}

	public static async getTokenPrice(pairAddress: string): Promise<number | undefined> {
		const lowerCasePair = pairAddress.toLowerCase();
		const version = this.versionMap.get(lowerCasePair) || await this.detectVersion(lowerCasePair);
		if (!version) {
			return undefined;
		}
		return this.fetchPrice(lowerCasePair, version);
	}

	private static async detectVersion(pairAddress: string): Promise<'V2' | 'V3' | null> {
		const V3_ABI = ['function tickSpacing() view returns (int24)'];
		const contractV3 = new ethers.Contract(pairAddress, V3_ABI, this.provider);

		try {
			await contractV3.tickSpacing();
			return 'V3';
		} catch {
			return 'V2';
		}
	}

	private static subscribeToSwaps(pairAddress: string, version: 'V2' | 'V3') {
		this.provider.on({ address: pairAddress }, async (log) => {
			if (log.blockNumber) {
				if (this.lastProcessedBlock.get(pairAddress) === log.blockNumber) {
					return;
				}

				this.lastProcessedBlock.set(pairAddress, log.blockNumber);
			}

			const price = await this.fetchPrice(pairAddress, version);
			const callback = this.callbacks.get(pairAddress);
			if (callback && price !== undefined) {
				callback(price);
			}
		});
	}

	private static async fetchPrice(pairAddress: string, version: 'V2' | 'V3'): Promise<number | undefined> {
		try {
			if (version === 'V2') {
				const contract = new ethers.Contract(pairAddress, PANCAKESWAP_V2_PAIR_ABI, this.provider);
				const [reserve0, reserve1] = await contract.getReserves();

				const price = Number(reserve0) / Number(reserve1);

				return price > 1 ? 1 / price : price;
			} else {
				const contract = new ethers.Contract(pairAddress, PANCAKESWAP_V3_POOL_ABI, this.provider);
				const { sqrtPriceX96 } = await contract.slot0();

				const price = (Number(sqrtPriceX96) ** 2) / 2 ** 192

				return price > 1 ? 1 / price : price;
			}
		} catch (err) {
			console.error('❌ Error fetching price:', err);
			return undefined;
		}
	}

	private static async getInitialPoolState(pairAddress: string): Promise<void> {
		const version = this.versionMap.get(pairAddress);
		if (!version) return;

		const price = await this.fetchPrice(pairAddress, version);
		const callback = this.callbacks.get(pairAddress);
		if (callback && price !== undefined) {
			callback(price);
		}
	}
}
