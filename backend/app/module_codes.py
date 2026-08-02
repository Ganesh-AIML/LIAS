"""Canonical module registry for module-based authorization.

Module codes are fixed and system-supplied — users never type them. Faculties,
exams, and staff assignments may only reference codes declared here; anything
else is rejected (422) by the payload validators in admin.py / staff_auth.py.
"""

MODULES = [
    {"code": "MAS701", "ifoa_subject": "CM1", "title": "Financial Mathematics and Contingencies"},
    {"code": "MAS702", "ifoa_subject": "CB1", "title": "Finance and Financial Reporting"},
    {"code": "MAS703", "ifoa_subject": "CB2", "title": "Business Economics"},
    {"code": "MAS704", "ifoa_subject": "CS1", "title": "Probability and Mathematical Statistics"},
    {"code": "MAS705", "ifoa_subject": "CS2", "title": "Insurance Risk Modelling"},
    {"code": "MAS706", "ifoa_subject": "CM2", "title": "Financial Economics"},
    {"code": "MAS707", "ifoa_subject": "CP2", "title": "Modelling Practice"},
    {"code": "MAS708", "ifoa_subject": "CP3", "title": "Communication Practice"},
    {"code": "MAS709", "ifoa_subject": "CP1", "title": "Actuarial Practice"},
]

MODULE_CODES = {m["code"] for m in MODULES}