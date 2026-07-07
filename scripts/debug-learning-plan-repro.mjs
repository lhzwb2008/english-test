/**
 * 复现排查脚本：用用户反馈的真实 student_profile + system_task_pool 调用学习计划 Bot，
 * 校验返回 plan 中每条 task 的 lesson_code / sourceRef 是否落在允许集合内。
 * 用法：node scripts/debug-learning-plan-repro.mjs
 */
import 'dotenv/config';
import { CozeAPI, RoleType } from '@coze/api';

const PLAN_BOT_ID = '7627028738093596712';

const STUDENT_PROFILE = `学生：三年级，2026-06-09 开始排计划。
当前分数：110，目标分数：135。
可用学习时间：每天1小时。
学习历史：小朋友一直学的剑桥体系英语教材，从KIDS BOX1开始学的，目前学THINK1第九单元，每周六下午一次线下课，每次一个半小时。在学校成绩中上等，学校译林教材，每天都有英语课，2026年3月测试了KET听力错了5个，阅读错了10个，小朋友能认真完成作业，自觉背默单词，但是性格比较拖拉，不能做到自主学习，每天有学习时间半小时到一小时。
start_date: 2026-06-09`;

const SYSTEM_TASK_POOL = `system_task_pool:
ID：235；课程名称：Speaking；任务标题：口语；任务详情：Tell us about a teacher you like.
How often do you use a mobile phone?
Which time of year do you like the most? (Why?)
Which do you like best, the morning or the afternoon? (Why?)
Tell us about sports you like.
What type of music do you like listening to?
Tell us what you do in the school holidays.；任务描述：按照PET口语标准批改反馈
ID：234；课程名称：Writing；任务标题：写作；任务详情：Question 1
Read this email from your English teacher Mrs Hallam and the notes you have made.
EMAILFrom: Mrs HallamTo: All studentsSubject: School talent show
Dear Students,I'm planning to organise a school talent competition. Students taking part in the competition can sing, dance, play a musical instrument or perform in some other way.（旁注：Good idea!）
The talent show could be for students of all ages, or just for students over 15. Which do you think would be better?（旁注：Explain which is better）
I think that some parents should judge the competition. Do you agree?（旁注：Tell Mrs Hallam）
And finally, what prizes do you think the winners should receive?（旁注：Suggest …）
Please reply soon.Beatrice Hallam
Write your email to Mrs Hallam using all the notes.
Question 2
You see this announcement on an English-language website.
Articles wanted!
Sport and exercise
Are there enough sports activities for young people to do in your area?Do you think it's important for young people to do sport and exercise?Why?
Write an article answering these questions and we'll publish the best ones.
Write your article.
Question 3
Your English teacher has asked you to write a story.Your story must begin with this sentence.
Lois smiled as she put the tickets in her pocket and walked out of her house.
Write your story.；任务描述：按照PET作文标准批改反馈
ID：233；课程名称：Reading ；任务标题：翻译；任务详情：Part3；
ID：232；课程名称：Listening ；任务标题：听力；
ID：226；教材：THINK2；单元：Unit3；课程名称：Lesson 7-Life Competencies ；任务标题：单词跟读；
ID：222；教材：THINK2；单元：Unit3；课程名称：Lesson6-DevelopSpeaking；任务标题：观看课程；
ID：223；教材：THINK2；单元：Unit3；课程名称：Lesson6-DevelopSpeaking；任务标题：书面作业；任务详情：必做：P34：第3-4、6-7题
；
ID：224；教材：THINK2；单元：Unit3；课程名称：Lesson6-DevelopSpeaking；任务标题：口语；任务详情：学生用书P36第7题 ：Use the questions in the Key Language box and in Exercise 5 （Could you ...?　Can you ...? Can I ...?　Is everything OK / all right?）to act out conversations in a shop, at home, at school and in other places. 选一个场景自编自演1段对话；
ID：225；教材：THINK2；单元：Unit3；课程名称：Lesson 7-Life Competencies ；任务标题：观看课程；
ID：227；教材：THINK2；单元：Unit3；课程名称：Lesson 7-Life Competencies ；任务标题：单词英译中；
ID：228；教材：THINK2；单元：Unit3；课程名称：Lesson 7-Life Competencies ；任务标题：书面作业；任务详情： Unit3单元测试；
ID：229；教材：THINK2；单元：Unit3；课程名称：Lesson 7-Life Competencies ；任务标题：听力；任务详情：P35：听力第1大题1-6题；
ID：230；教材：THINK2；单元：Unit3；课程名称：Lesson 7-Life Competencies ；任务标题：口语；任务详情：学生用书P37第6题：Tell your friends about your plans. 分享你的一个目标以及实现该目标的计划）；
ID：231；教材类型：考试冲刺；教材：PET青少1；单元：Test1；课程名称：Listening；任务标题：听力；
ID：216；教材：THINK2；单元：Unit3；课程名称：Lesson4-Reading2；任务标题：书面作业；任务详情：必做：P30：第5题；P32： 第1-3题
；
ID：221；教材：THINK2；单元：Unit3；课程名称：Lesson5- Grammar3Vocabulary2；任务标题：口语；任务详情：学生用书P35第10题（自问自答）：1 What kind(s) of programmes do you really like?
2 What kind(s) of programmes do you really NOT like?
3 What's your favourite programme at the moment? Why?
4 What's your least favourite programme at the moment? Why?
5 How do you watch TV programmes - on TV, on your phone,on a tablet...?
；
ID：220；教材：THINK2；单元：Unit3；课程名称：Lesson5- Grammar3Vocabulary2；任务标题：书面作业；任务详情：必做：P29：第8-9题；P30： 第3-4题； P33：第1、3、4题;选做：P33：第2题
；
ID：219；教材：THINK2；单元：Unit3；课程名称：Lesson5- Grammar3Vocabulary2；任务标题：单词中译英；
ID：218；教材：THINK2；单元：Unit3；课程名称：Lesson5- Grammar3Vocabulary2；任务标题：单词跟读；
ID：217；教材：THINK2；单元：Unit3；课程名称：Lesson5- Grammar3Vocabulary2；任务标题：观看课程；
ID：215；教材：THINK2；单元：Unit3；课程名称：Lesson4-Reading2；任务标题：课文朗读；
ID：214；教材：THINK2；单元：Unit3；课程名称：Lesson4-Reading2；任务标题：单词英译中；
ID：213；教材：THINK2；单元：Unit3；课程名称：Lesson4-Reading2；任务标题：单词跟读；
ID：212；教材：THINK2；单元：Unit3；课程名称：Lesson4-Reading2；任务标题：观看课程；
ID：207；教材：THINK2；单元：Unit3；课程名称：Lesson3- ListeningGrammar2；任务标题：观看课程；
ID：203；教材：THINK2；单元：Unit3；课程名称：Lesson2-Vocabulory1Grammar1；任务标题：单词跟读；
ID：204；教材：THINK2；单元：Unit3；课程名称：Lesson2-Vocabulory1Grammar1；任务标题：单词中译英；
ID：205；教材：THINK2；单元：Unit3；课程名称：Lesson2-Vocabulory1Grammar1；任务标题：书面作业；任务详情：必做：P28：第1-4题；P29：Get it right 1-5题； P30：1-2题；选做：P28:第5题
；
ID：206；教材：THINK2；单元：Unit3；课程名称：Lesson2-Vocabulory1Grammar1；任务标题：口语；任务详情：学生用书P32第6题：Which type of film do you like best? And give an example.（分享自己最喜欢的电影类型并举一个例子）；
ID：208；教材：THINK2；单元：Unit3；课程名称：Lesson3- ListeningGrammar2；任务标题：单词跟读；
ID：209；教材：THINK2；单元：Unit3；课程名称：Lesson3- ListeningGrammar2；任务标题：单词英译中；
ID：210；教材：THINK2；单元：Unit3；课程名称：Lesson3- ListeningGrammar2；任务标题：书面作业；任务详情：必做：P29：第6题;选做：P29:第7题
；
ID：211；教材：THINK2；单元：Unit3；课程名称：Lesson3- ListeningGrammar2；任务标题：听力；任务详情：必做：练习册 P34： 第1题   选做 P34： 第2题；
ID：197；教材类型：长线学习；教材：THINK2；单元：Unit3；课程名称：Lesson1-Reading1；任务标题：观看课程；
ID：202；教材：THINK2；单元：Unit3；课程名称：Lesson2-Vocabulory1Grammar1；任务标题：观看课程；
ID：201；教材：THINK2；单元：Unit3；课程名称：Lesson1-Reading1；任务标题：口语；任务详情：学生用书P30第2题：Which kind of entertainment do you like ? And Why？(分享自己最喜欢的一项娱乐活动并说明原因）
；
ID：200；教材：THINK2；单元：Unit3；课程名称：Lesson1-Reading1；任务标题：课文朗读；
ID：199；教材：THINK2；单元：Unit3；课程名称：Lesson1-Reading1；任务标题：单词英译中；
ID：198；教材：THINK2；单元：Unit3；课程名称：Lesson1-Reading1；任务标题：单词跟读；`;

const ALLOWED_IDS = new Set(
  [...SYSTEM_TASK_POOL.matchAll(/ID[：:]\s*(\d+)/g)].map((m) => m[1]),
);

const USER_MESSAGE = `student_profile:
${STUDENT_PROFILE}

${SYSTEM_TASK_POOL}

请仅输出 JSON 学习计划。schedule_mode=by_date，含 days[].date。days[].tasks 必须全部来自上述 system_task_pool，每项 sourceRef 必须是对应任务的 ID（字符串）。`;

function sliceJsonObject(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('未能从助手回复中截取 JSON 对象片段');
  }
  return s.slice(start, end + 1);
}

function validatePlan(plan, allowedIds) {
  const errors = [];
  let taskCount = 0;
  if (!plan || !Array.isArray(plan.days)) {
    errors.push('缺少或非法 days 数组');
    return { errors, taskCount };
  }
  for (const day of plan.days) {
    const tasks = day?.tasks;
    if (!Array.isArray(tasks)) continue;
    for (let i = 0; i < tasks.length; i += 1) {
      taskCount += 1;
      const t = tasks[i];
      const ref = t?.sourceRef ?? t?.source_ref;
      const id = ref === undefined || ref === null ? '' : String(ref).trim();
      if (id === '') {
        errors.push(
          `day_index=${day?.day_index} date=${day?.date} task#${i} sourceRef 为空。detail_zh="${t?.detail_zh}"`,
        );
        continue;
      }
      if (!allowedIds.has(id)) {
        errors.push(
          `day_index=${day?.day_index} date=${day?.date} task#${i} sourceRef="${id}" 不在任务池中！detail_zh="${t?.detail_zh}"`,
        );
      }
    }
  }
  return { errors, taskCount };
}

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN（见 .env）');

  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  console.log('允许的 sourceRef ID 集合大小:', ALLOWED_IDS.size);
  console.log('调用学习计划 Bot createAndPoll…', PLAN_BOT_ID);

  const poll = await client.chat.createAndPoll({
    bot_id: PLAN_BOT_ID,
    user_id: process.env.COZE_DEBUG_USER_ID || 'debug-learning-plan-repro',
    additional_messages: [
      {
        role: RoleType.User,
        content_type: 'text',
        content: USER_MESSAGE,
      },
    ],
  });

  const messages = poll.messages ?? [];
  const answerParts = messages
    .filter((m) => m.type === 'answer')
    .map((m) => m.content)
    .filter(Boolean);
  const raw = answerParts.join('');
  if (!raw) {
    console.error('未收到 answer 消息，poll:', JSON.stringify(poll.chat ?? poll, null, 2));
    process.exit(1);
  }

  const fs = await import('fs');
  const outFile = process.env.REPRO_OUT || 'scripts/.repro-raw-output.json';
  fs.writeFileSync(outFile, raw);
  console.log(`原始返回已保存到 ${outFile}（字符数:`, raw.length, '）');

  let plan;
  try {
    plan = JSON.parse(sliceJsonObject(raw));
  } catch (e) {
    console.error('JSON.parse 失败:', e?.message ?? e);
    console.error('---- raw (截断前 4000 字) ----\n', raw.slice(0, 4000));
    process.exit(1);
  }

  const { errors, taskCount } = validatePlan(plan, ALLOWED_IDS);
  console.log('\n校验结果:');
  console.log('  任务总数:', taskCount);
  if (errors.length) {
    console.log('  发现问题:', errors.length, '条');
    for (const err of errors) console.log('   - ', err);
  } else {
    console.log('  全部通过（所有 sourceRef 均在任务池中）');
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
