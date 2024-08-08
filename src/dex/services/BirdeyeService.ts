import {client as WebSocketClient} from 'websocket';

export class BirdeyeService {
	static async subscribeToTokenPrice(): Promise<void> {
		// const wsUrl = 'wss://public-api.birdeye.so/socket/solana?x-api-key=3ff79dbc9ce94665b140fafdfd84f556'


		const client = new WebSocketClient();

		client.on('connectFailed', function (error) {
			console.log('Connect Error: ' + error.toString());
		});

		client.on('connect', function (connection) {
			console.log('WebSocket Client Connected');

			connection.on('error', function (error) {
				console.log('Connection Error: ' + error.toString());
			});

			connection.on('close', function () {
				console.log('WebSocket Connection Closed');
			});

			connection.on('message', function (message) {
				if (message.type === 'utf8') {
					console.log('Received: \'' + message.utf8Data + '\'');
					// Process received data here
				}
			});

			// Send subscription message here
			const subscriptionMsg = {
				type: 'SUBSCRIBE_PRICE',
				data: {
					chartType: '1m',
					currency: 'pair',
					address: 'FmKAfMMnxRMaqG1c4emgA4AhaThi4LQ4m2A12hwoTibb'
				}
			};

			connection.send(JSON.stringify(subscriptionMsg));
		});

		client.connect('wss://public-api.birdeye.so/socket/solana?x-api-key=7ec845ac5aed45d8881e0a36e1731393', 'echo-protocol', 'https://birdeye.so', {
			'X-API-KEY': '7ec845ac5aed45d8881e0a36e1731393'
		});

	}
}
