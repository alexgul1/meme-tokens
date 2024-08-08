import WebSocket from 'ws'


// const BITQUERY_WS_URL = 'wss://streaming.bitquery.io/eap';

export class BitQueryService {
	private static bitQueryConnection: WebSocket

	static subscribeToToken(tokenAddress: string): void {
		BitQueryService.bitQueryConnection = new WebSocket(
			'wss://streaming.bitquery.io/eap?token=ory_at_LfDtPKu-53vrZVj5CMHek_anOnI8RC7lwGLTRcdyQ0U.URRGsPH-LrTtNP-K809SRHmNa7r7HqHGCCvegSRCRcU\t',
			['graphql-ws'],
			{
				headers: {
					'Sec-WebSocket-Protocol': 'graphql-ws',
					'Content-Type': 'application/json',
				},
			}
		);

		BitQueryService.bitQueryConnection.on('open', () => {
			const initMessage = JSON.stringify({ type: 'connection_init' });
			BitQueryService.bitQueryConnection.send(initMessage);

			// After initialization, send the actual subscription message
			setTimeout(() => {
				const message = JSON.stringify({
					type: 'start',
					id: '1',
					payload: {
						query: `
						   subscription {
							  Solana {
								DEXTradeByTokens(
								  limit: {count: 1}
								  orderBy: {descending: Block_Time}
								  where: {Trade: {Currency: {MintAddress: {is: "So11111111111111111111111111111111111111112"}}, Side: {Currency: {MintAddress: {is: "${tokenAddress}"}}}}}
								) {
								  Block {
									Time
								  }
								  Trade {
									Price
								  }
								}
							  }
							}`
					},
				});

				BitQueryService.bitQueryConnection.send(message);
			}, 1000);
		})


		BitQueryService.bitQueryConnection.on('message', (data) => {
			let response;

			if (typeof data === 'string') {
				response = JSON.parse(data);
			}

			console.log(response)
			if (response.type === 'data') {
				// Broadcast the data to all connected clients of your local server
				console.log('Received data from Bitquery: ', response.payload.data);

				// Close the connection after receiving data
				this.bitQueryConnection.close();
			}
		});

		BitQueryService.bitQueryConnection.on('close', () => {
			console.log('Disconnected from Bitquery.');
		});

		BitQueryService.bitQueryConnection.on('error', (error) => {
			console.error('WebSocket Error:', error);
		});


	}
}
