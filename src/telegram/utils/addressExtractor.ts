export const extractSolOrPairAddress = (message: string): { address: string; type: 'token' | 'pair' } | null => {
	// Regular expression for optional parts in Dextools URL
	const dextoolsPattern = /https:\/\/(?:www\.)?dextools\.io(?:\/app\/en\/solana)?\/pair-explorer\/([1-9A-HJ-NP-Za-km-z]{32,44})/;
	const dextoolsMatch = message.match(dextoolsPattern);

	if (dextoolsMatch) {
		return { address: dextoolsMatch[1], type: 'pair' };
	}

	// Regular expression for Dexscreener pair URL
	const pairUrlPattern = /https:\/\/dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/;
	const pairMatch = message.match(pairUrlPattern);

	if (pairMatch) {
		return { address: pairMatch[1], type: 'pair' }; // Return the token address part of the URL with type 'pair'
	}

	// Regular expression for Solana token address
	const solAddressPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
	const solMatch = message.match(solAddressPattern);

	if (solMatch) {
		return { address: solMatch[0], type: 'token' };
	}

	return null;
}
