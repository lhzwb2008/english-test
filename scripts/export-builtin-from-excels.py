#!/usr/bin/env python3
"""从 ref/ 下四份陪跑 Excel 导出 coze/prompts/builtin-tasks-from-excels.md"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / 'ref'


def clean(x):
    if x is None:
        return ''
    s = str(x).strip()
    if s in ('', '无', 'nan'):
        return ''
    return s


def md_escape(s):
    return s.replace('\n', ' ').strip()[:2000]


def parse_think1_xlsx():
    import openpyxl

    p = REF / 'Think1 完整版陪跑计划表.xlsx'
    wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
    out = ['## 内置 · think1（来自 Think1 完整版陪跑计划表）', '']
    for sn in wb.sheetnames:
        ws = wb[sn]
        rows = list(ws.iter_rows(values_only=True))
        if len(rows) < 6:
            continue
        out.append(f'### Sheet: {sn}')
        out.append('')
        for row in rows[5:]:
            if not row or len(row) < 3:
                continue
            code = clean(row[2]) if len(row) > 2 else ''
            if not code:
                continue
            line = [f'#### {code}']
            labels = ['练习册必做', '练习册选做', '作业纸必做', '作业纸选做', '口语作业']
            for i, lb in enumerate(labels):
                ci = 3 + i
                v = clean(row[ci]) if len(row) > ci else ''
                if v:
                    line.append(f'- {lb}：{md_escape(v)}')
            out.extend(line)
            out.append('')
        out.append('')
    wb.close()
    return '\n'.join(out)


def row_to_md_think2(row, ncols):
    cells = [clean(row[i]) for i in range(min(ncols, len(row)))]
    while cells and not cells[-1]:
        cells.pop()
    if len(cells) < 2:
        return None
    course = cells[1]
    if not course or course in ('课程', '序号', '日期'):
        return None
    rest = [c for i, c in enumerate(cells) if i not in (0, 1) and c]
    desc = '；'.join(rest)
    return f'#### {course}\n- 课后：{md_escape(desc)}\n\n'


def parse_think2_xls():
    import xlrd

    p = REF / 'THINK2 3V1陪跑计划表.xls'
    wb = xlrd.open_workbook(p)
    out = ['## 内置 · think2（来自 THINK2 3V1陪跑计划表）', '']
    for si in range(wb.nsheets):
        sh = wb.sheet_by_index(si)
        name = sh.name
        out.append(f'### Sheet: {name}')
        out.append('')
        for ri in range(sh.nrows):
            row = [sh.cell_value(ri, ci) for ci in range(sh.ncols)]
            blk = row_to_md_think2(row, sh.ncols)
            if blk:
                out.append(blk)
        out.append('')
    return '\n'.join(out)


def parse_pu2_xls():
    import xlrd

    p = REF / 'Power Up2 完整版 3V1陪跑计划表.xls'
    wb = xlrd.open_workbook(p)
    out = ['## 内置 · powerup2（来自 Power Up2 陪跑计划表）', '']
    for si in range(wb.nsheets):
        sh = wb.sheet_by_index(si)
        if '学生' in sh.name:
            continue
        name = sh.name
        out.append(f'### Sheet: {name}')
        out.append('')
        start = 4
        for ri in range(min(8, sh.nrows)):
            vals = [clean(sh.cell_value(ri, ci)) for ci in range(min(8, sh.ncols))]
            if any('课程' == x for x in vals):
                start = ri + 3
                break
        for ri in range(start, sh.nrows):
            row = [sh.cell_value(ri, ci) for ci in range(sh.ncols)]
            course = ''
            for ci in range(min(5, len(row))):
                v = clean(row[ci])
                if v and ('PU2' in v or v.startswith('Welcome') or 'U' in v[:3]):
                    course = v
                    break
            if not course:
                course = clean(row[2]) if len(row) > 2 else ''
            if not course or '课程' in course:
                continue
            parts = []
            for ci in range(len(row)):
                v = clean(row[ci])
                if not v or v == course:
                    continue
                if re.match(r'^[\d.]+$', v.split('/')[0][:4] or 'x'):
                    if len(v) < 8:
                        continue
                parts.append(v)
            desc = '；'.join(dict.fromkeys(parts))[:1500]
            out.append(f'#### {course}\n- 课后：{md_escape(desc)}\n\n')
        out.append('')
    return '\n'.join(out)


def parse_pu3_xls():
    import xlrd

    p = REF / 'Power Up3 完整版 3V1陪跑计划表.xls'
    wb = xlrd.open_workbook(p)
    out = ['## 内置 · powerup3（来自 Power Up3 陪跑计划表）', '']
    for si in range(wb.nsheets):
        sh = wb.sheet_by_index(si)
        if '学生' in sh.name:
            continue
        name = sh.name
        out.append(f'### Sheet: {name}')
        out.append('')
        for ri in range(4, sh.nrows):
            row = [sh.cell_value(ri, ci) for ci in range(sh.ncols)]
            course = ''
            if len(row) > 3:
                course = clean(row[3]) or clean(row[2])
            elif len(row) > 2:
                course = clean(row[2])
            if not course or '课程' in course:
                continue
            parts = []
            for ci in range(4, len(row)):
                v = clean(row[ci])
                if v and not re.match(r'^[\d.]+$', v):
                    parts.append(v)
            desc = '；'.join(parts[:8])[:1500]
            out.append(f'#### {course}\n- 课后：{md_escape(desc or "见表")}\n\n')
        out.append('')
    return '\n'.join(out)


def main():
    parts = [
        parse_think1_xlsx(),
        parse_think2_xls(),
        parse_pu2_xls(),
        parse_pu3_xls(),
    ]
    outp = ROOT / 'coze/prompts/builtin-tasks-from-excels.md'
    text = '\n---\n\n'.join(parts)
    outp.write_text(text, encoding='utf-8')
    print('written', outp, 'lines', len(text.splitlines()))


if __name__ == '__main__':
    main()
