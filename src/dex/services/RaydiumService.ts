// import {WebSocketService} from '../../websocket/WebSocketService';
//
// interface RaydiumTokenPrice {
//     // Define the structure based on Raydium's API response
//     price: string;
//     timestamp: number;
// }

export interface IRaydiumPrice {
	id: string,
	success: boolean,
	data: {
		[key: string]: string
	}
}
export class RaydiumService {


	static async getTokenPrice(pairAddress: string): Promise<IRaydiumPrice|null> {
		try {
			const url = `https://api-v3.raydium.io/mint/price?mints=${pairAddress}`;

			const response  = await fetch(url);

			return await response.json() as IRaydiumPrice

		} catch (e) {
			return null
		}
	}

	static async subscribeToTokenPrice(tokenAddressList: Array<string>, callback: (price: IRaydiumPrice) => void): Promise<void> {
		try {
			// Replace with Raydium API endpoint if available
			const response = await this.getTokenPrice(tokenAddressList.join(','));


			console.log(response)

			if (response) {
				callback(response)
			}



			setTimeout(() => this.subscribeToTokenPrice(tokenAddressList, callback), 5000)

		} catch (error) {
			console.error('Error fetching Raydium token price:', error);
			setTimeout(() => this.subscribeToTokenPrice(tokenAddressList, callback), 5000)

		}
	}
}
