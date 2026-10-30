---
id: TUI-136
title: 'Attendance sheet: student names cut off in the dialog'
status: done
phase: P7
module: web
priority: P0
size: S
endpoints: []
branch: task/tui-136-attendance-names
pr: 87
---

# TUI-136 Attendance sheet: student names cut off in the dialog

The owner reported that in the attendance dialog a teacher couldn't read the students' names: from
tablet width up each row put the name beside four buttons fixed at 400px, which left the name
about 100px in the dialog. The name now keeps at least 14rem, and the buttons wrap onto their
own line when the row is too narrow for both. The lesson page keeps one line per student.

Then, at the owner's request: one line per student, with small icon-only status buttons and a
legend above the list saying what each icon means. Phones keep the name on its own line above
four 44px buttons, since one line leaves the name no room there.
