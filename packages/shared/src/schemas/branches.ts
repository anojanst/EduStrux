import { z } from '../zod';
import { Timestamp } from './common';

const Name = z.string().trim().min(1).max(120);
const Address = z.string().trim().max(500).nullable();
const Capacity = z.number().int().min(1).max(1000).nullable().openapi({
  description: 'How many students the room seats. null = not set.',
  example: 12,
});
const UpdatedAt = Timestamp.openapi({
  description: 'The updatedAt you last read. A newer value on the server returns 409.',
});

export const Branch = z
  .object({
    id: z.string().openapi({ example: 'brn_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    name: z.string(),
    address: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Branch');
export type Branch = z.infer<typeof Branch>;

export const CreateBranch = z
  .object({
    name: Name.openapi({ example: 'Albany' }),
    address: Address.optional().openapi({ example: '12 Main Road, Albany, Auckland' }),
  })
  .openapi('CreateBranch');
export type CreateBranch = z.infer<typeof CreateBranch>;

export const UpdateBranch = z
  .object({ updatedAt: UpdatedAt, name: Name, address: Address })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateBranch');
export type UpdateBranch = z.infer<typeof UpdateBranch>;

export const Room = z
  .object({
    id: z.string().openapi({ example: 'rm_01j9z3k6m2q8w4e5r6t7y8u9i0' }),
    branchId: z.string(),
    name: z.string(),
    capacity: z.number().int().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .openapi('Room');
export type Room = z.infer<typeof Room>;

export const CreateRoom = z
  .object({
    name: Name.openapi({ example: 'Room 1' }),
    capacity: Capacity.optional(),
  })
  .openapi('CreateRoom');
export type CreateRoom = z.infer<typeof CreateRoom>;

/** A room stays in its branch: there's no branchId here. */
export const UpdateRoom = z
  .object({ updatedAt: UpdatedAt, name: Name, capacity: Capacity })
  .partial()
  .required({ updatedAt: true })
  .openapi('UpdateRoom');
export type UpdateRoom = z.infer<typeof UpdateRoom>;
