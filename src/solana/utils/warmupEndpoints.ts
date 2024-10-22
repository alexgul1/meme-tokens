export const warmUpEndpoint =  async (endpoint: string) => {
	setInterval(async () => {
		try {
			await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: '1',
					method: 'getHealth',
				}),
			})
		} catch (e) {
			console.log(e)
		}

	}, 2500)
}
