#!/usr/bin/env python3
"""生成一张英文作业纸的合成图片，用于图片批改 bot 的端到端测试。

含两题阅读理解（带 passage）+ 一题填空 + 一题作文（题干）。学生作答用手写体的近似——
我们用普通字体加粗模拟，足以让 OCR 识别出英文。生成到 tests/fixtures/mock_homework.png。
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures' / 'mock_homework.png'

DEJAVU = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
DEJAVU_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def font(size, bold=False):
    p = DEJAVU_B if bold else DEJAVU
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.load_default()


def main() -> None:
    W, H = 1200, 1700
    img = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(img)

    d.text((40, 30), 'THINK1 Unit 1 — Reading & Practice', fill='black', font=font(40, True))
    d.text((40, 90), 'Name: Wu  |  Date: 2026-05-04', fill='black', font=font(28))

    d.line([(40, 140), (W - 40, 140)], fill='black', width=2)

    d.text((40, 160), 'Reading Passage', fill='black', font=font(32, True))
    passage = (
        "My name is Anna. I am twelve years old. I live in a small town with my family.\n"
        "I have got a brother and a sister. My brother plays football every weekend. My sister\n"
        "likes painting. I like reading books and playing the guitar. I never play computer\n"
        "games on weekdays because I think they are boring. On Saturdays my whole family\n"
        "goes to the park. I usually take my camera with me to take photos of birds."
    )
    y = 210
    for line in passage.split('\n'):
        d.text((40, y), line, fill='black', font=font(26))
        y += 36

    d.line([(40, y + 10), (W - 40, y + 10)], fill='black', width=1)
    y += 30

    d.text((40, y), 'A. Reading Comprehension (write A/B/C/D)', fill='black', font=font(30, True))
    y += 50
    q1 = '1. What does Anna like doing?'
    d.text((40, y), q1, fill='black', font=font(28)); y += 38
    for opt in ['A. playing computer games', 'B. reading books and playing the guitar',
                'C. painting', 'D. playing football']:
        d.text((80, y), opt, fill='black', font=font(26)); y += 32
    d.text((40, y), 'Student answer:  B', fill='black', font=font(28, True)); y += 50

    q2 = '2. Why does Anna NOT play computer games on weekdays?'
    d.text((40, y), q2, fill='black', font=font(28)); y += 38
    for opt in ['A. They are boring.', 'B. She has no computer.',
                'C. Her parents do not allow her.', 'D. She is too busy.']:
        d.text((80, y), opt, fill='black', font=font(26)); y += 32
    d.text((40, y), 'Student answer:  C', fill='black', font=font(28, True)); y += 60

    d.text((40, y), 'B. Fill in the blanks', fill='black', font=font(30, True)); y += 50
    d.text((40, y), '3. My brother ______ football every weekend.', fill='black', font=font(28)); y += 38
    d.text((40, y), 'Student answer:  play', fill='black', font=font(28, True)); y += 50
    d.text((40, y), '4. I ______ playing the guitar.   (like / likes)', fill='black', font=font(28)); y += 38
    d.text((40, y), 'Student answer:  like', fill='black', font=font(28, True)); y += 60

    d.text((40, y), 'C. Writing (about 30 words)', fill='black', font=font(30, True)); y += 50
    d.text((40, y), 'Write about your hobby.', fill='black', font=font(28)); y += 38
    student_writing = (
        'I like play football very much. I play it with my friend in the park\n'
        'every weekend. It is fun and I think football make me happy.'
    )
    for line in student_writing.split('\n'):
        d.text((60, y), line, fill='black', font=font(26, True))
        y += 34

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, 'PNG')
    print('written', OUT, img.size)


if __name__ == '__main__':
    main()
