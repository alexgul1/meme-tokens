import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Ensure to call this before importing any other modules!
Sentry.init({
	dsn: 'https://00b44138724b2191461b61fbe57556c1@o4507845523275776.ingest.de.sentry.io/4507922126012496',
	integrations: [
		nodeProfilingIntegration(),
	],
	// Tracing
	tracesSampleRate: 1.0, //  Capture 100% of the transactions

	// Set sampling rate for profiling - this is relative to tracesSampleRate
	profilesSampleRate: 1.0,
});
