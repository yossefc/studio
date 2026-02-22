
'use client';

/**
 * @fileOverview This is the primary entry point for Firebase in the client-side app.
 * It re-exports the initialization logic and all React-specific hooks and providers.
 */

export * from './init';
export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
