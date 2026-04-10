# 冒烟测试（仅验证多模态音频是否到达模型）

用户消息中会包含上传的音频（audio + file_id）。

请只听音频，用英文转写出说话内容。

只输出一个 JSON 对象，不要 Markdown 围栏。格式：

{"transcript":"英文转写全文","audio_received":true}

若完全无法从音频得到有效内容：

{"transcript":"","audio_received":false,"note":"英文原因"}

不要输出 JSON 以外的任何字符。
