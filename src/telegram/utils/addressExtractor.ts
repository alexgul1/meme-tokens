export const extractSolAddress = (message: string): string|null => {
	// Regular expression for Solana token address
	const solAddressPattern = /[\da-z]{32,44}/i;
	const solMatch = message.match(solAddressPattern);

	if (solMatch) {
		return solMatch[0]
	}

	return null
}
