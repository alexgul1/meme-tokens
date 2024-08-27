import WebSocket from 'ws';
import * as Sentry from '@sentry/node';
// import * as crypto from 'crypto';

export class WebSocketService {
	private ws: WebSocket;

	constructor(url: string, headers: NonNullable<unknown>) {
		console.log({
			...headers,
			// 'Sec-WebSocket-Key': 'YpwBSFols9U1IeMeLw+Akg=='
		})
		this.ws = new WebSocket(url, {
			headers: {
				...headers,
				// 'Sec-WebSocket-Key': this.generateWebSocketKey()
			}
		});





		this.ws.on('open', () => {
			console.log('WebSocket connection opened.');
		});

		this.ws.on('message', (data: WebSocket.MessageEvent) => {
			this.handleMessage(data);
		});

		this.ws.on('close', () => {
			console.log('WebSocket connection closed.');
		});

		this.ws.on('error', (error: Error) => {
			Sentry.captureException({message: 'WebSocket error', error});


			console.error('WebSocket error:', error);
		});


	}

	// private generateWebSocketKey() {
	// 	const buffer = crypto.randomBytes(16);
	// 	const key = buffer.toString('base64');
	// 	return key;
	// }

	private handleMessage(data: WebSocket.MessageEvent) {
		try {
			const message = JSON.parse(data.toString());

			if (message === 'ping') {
				console.log('ping');
				this.ws.send('pong');
				return;
			}
			console.log('Received message:', message);

			// Handle price update
			this.handlePriceUpdate(message);
		} catch (error) {
			console.error('Error parsing message:', error);
		}
	}

	private handlePriceUpdate(message: any) {
		// Implement logic to handle price updates
		console.log('Price Update:', message);
	}

	public sendMessage(message: any) {
		this.ws.send(JSON.stringify(message));
	}
}
