# **App Name**: TalmudAI

## Core Features:

- Reference Input & Submission: Allows users to input a reference, select a language (Hebrew/English), and initiate study guide generation. Includes validation, normalization to Sefaria's 'tref' format, a loading screen with steps (Fetch, Chunk, Explain, Summarize, Publish), and a Cancel button.
- Sefaria Text Retrieval: Backend uses Sefaria Texts v3 to retrieve text based on the provided 'tref' with language/direction parameters, supporting RTL for Hebrew content and light formatting cleanup. Use `lang` + optional `version`, and set `context=0` to avoid surrounding text when requesting a specific ref
- Strict Chunking Engine: Segments text into 15-25 word chunks, avoiding sentence breaks by prioritizing punctuation. Generates stable IDs `OC_{siman}_{seif}_{SOURCE}_chunk_{k}`(ex: `OC_1_1_SA_chunk_1`) and calculates 'rawHash' for idempotence.
- AI-Powered Contextual Explanation Tool: Orchestrates Gemini-based explanations server-side, using Segment N-1 + explanation N-1 as context. Includes Firestore caching with immediate saving after response, exponential retry for transient errors, a strict prompt, and storing the 'modelName' with each explanation; uses an AI tool.
- Rabbinic Exam Summary Tool: Final Gemini call for a clear summary in bullet points, focused on Halacha Lema'aseh; uses an AI tool.
- Google Docs Integration & Publishing: Creates a Google Doc (Orach Chayim – Siman X Seif Y (TalmudAI)), inserts content via the Docs API, applies bolding using documents.batchUpdate / UpdateTextStyle, and stores docId + docUrl in Firestore. Bold is applied by computing character ranges and sending `UpdateTextStyleRequest` with startIndex/endIndex in `documents.batchUpdate`
- Shareable Document Access: Provides a Success screen with an Open in Google Drive button and an 'My Guides' history list with re-open link functionality.

## Style Guidelines:

- Primary: #2259C3
- Background: #F0F2F4
- Accent: #30CBE9
- Fonts: Heebo (headlines) + Assistant (body), RTL-first
- Navigation: Home → Generate → Result (+ My Guides)
- Cards lisibles, grande line-height, sections séparées
- Icons line-based minimalistes
- Animations: spinner + transitions légères