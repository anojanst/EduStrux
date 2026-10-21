---
id: TUI-42
title: Staff invitations and staff management
status: done
phase: P3
module: people
priority: P0
size: M
endpoints:
  - GET /staff
  - POST /staff/invitations
  - POST /api/v1/invitations/{token}/accept
  - PATCH /staff/{membershipId}
  - DELETE /staff/{membershipId}
  - POST /guardians/{guardianId}/invitation
branch: task/tui-42-staff-invitations
pr: 50
---

# TUI-42 Staff invitations and staff management

Role + branch ids on membership. Staff profiles.

Built with D-131: invites by email (token in the answer, email queued for TUI-65), parent
invites through the guardian (`POST /guardians/{guardianId}/invitation`), branch managers limited
to their own branches and roles that don't reach the org, and no removing a teacher who still
teaches a class. Staff profile fields beyond the user's name and email are left for later.
