import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Adds `.openapi()` so these schemas can describe themselves in the generated API docs.
// Importing `z` from here (not from 'zod') keeps that in one place.
extendZodWithOpenApi(z);

export { z };
