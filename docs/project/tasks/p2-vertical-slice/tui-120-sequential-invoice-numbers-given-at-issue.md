---
id: TUI-120
title: Sequential invoice numbers, given at issue
status: done
phase: P2
module: billing
priority: P1
size: M
endpoints: []
branch: task/tui-120-121-invoice-numbers-payment-filter
pr: 61
---

# TUI-120 Sequential invoice numbers, given at issue

The owner's decision (2026-10-27): each org numbers its invoices INV-0001, INV-0002… in order, given when a draft is issued, so drafts and voided drafts leave no gaps. A voided issued invoice keeps its number. The number shows on the staff screens, PDFs, emails and the portal; the bank reference stays for transfers. Resolves the open question in D-142.
