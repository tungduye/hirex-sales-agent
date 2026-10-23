import "server-only";
import { postOpenAIResponse, responseOutputText } from "@/lib/openai/responses";
import { aiRecruiterPersonaPolicy, aiRecruiterSharedPolicy } from "@/modules/ai-recruiter/core/persona-policy";
import { recruiterResultJsonSchema, resultSchema } from "../core/recruiter-result-schema";

// One model call per AI Recruiter run. Returns schema-validated output; every field is still
// untrusted and is re-checked by the policy code in process-ai-recruiter.ts before anything is sent.
export async function generateRecruiterReply(input: {
  model: string;
  bot: Record<string, unknown>;
  state: Record<string, unknown> | null;
  messages: unknown[];
  jobs: unknown[];
  stages: unknown[];
  latestInbound: { text: string; cvEvidence: boolean };
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
  const botType = String(input.bot.bot_type ?? "RECRUITER");
  const roleContext = aiRecruiterPersonaPolicy(botType);
  const recruiterPolicy =
    "Chỉ dùng job được cung cấp; không bịa lương, nhiệm vụ, yêu cầu, quy trình, công ty hoặc cam kết. Có thể giới thiệu sơ bộ một job theo hướng nghề và địa điểm khi ứng viên hỏi; phải ghi rõ missingFields nếu chưa biết điều kiện quan trọng, không khẳng định ứng viên đạt yêu cầu. Trả lời trước, hỏi tối đa một ý liên quan trực tiếp job nếu cần; askedQuestion=false là hợp lệ. Không khai thác tuần tự theo checklist. Chỉ xác nhận phù hợp BrSE khi có bằng chứng BrSE/làm cầu nối, phù hợp quản lý khi có bằng chứng quản lý. Địa điểm đã chọn là ưu tiên cứng. Nếu không có job đúng nhu cầu thì nói rõ chưa có trong danh sách, không thay bằng job trái địa điểm. facts chỉ chứa dữ kiện mới được latestInbound nói rõ, evidenceQuote phải là trích dẫn nguyên văn. jobMatches chỉ chấm job dựa trên bằng chứng; mọi job được nhắc phải có trong jobMatches, selectedJobId là job đang giới thiệu. latestInbound.cvEvidence=false thì cv_received không được true. Khi có CV thật, khiếu nại hoặc tình huống nhạy cảm thì bàn giao người thật.";
  const instructions = `${aiRecruiterSharedPolicy} ${botType === "RECRUITER" ? recruiterPolicy : "Bám đúng thứ tự stages được cung cấp. Không tạo jobMatches, không chọn job và không diễn giải người đang chat là ứng viên trừ khi vai trò yêu cầu."} latestInbound có thể gồm nhiều tin liên tiếp: đọc toàn bộ như một câu trả lời. Không hỏi lại dữ kiện đã có trong state.profile hoặc lịch sử; chỉ hỏi làm rõ nếu mâu thuẫn. Trả lời yêu cầu trực tiếp trước, sau đó tối đa một câu hỏi về thông tin còn thiếu. Văn phong recruiter chuyên nghiệp, rõ ràng, đủ ý (không cộc lốc), cụ thể, không khen sáo rỗng hoặc khẳng định có job khi chưa có dữ liệu. Trả JSON đúng schema, xưng em và gọi anh/chị theo ngữ cảnh.`;
  const response = await postOpenAIResponse({
    apiKey,
    timeoutMs: 45_000,
    body: {
      model: input.model,
      max_output_tokens: 1900,
      instructions: `${roleContext} Mỗi lượt chỉ xử lý một mục tiêu và không tự chuyển sang vai trò chatbot khác. ${String(input.bot.extra_rules ?? "")} ${instructions}`,
      input: JSON.stringify({
        bot: input.bot,
        state: input.state,
        latestInbound: input.latestInbound,
        messages: input.messages,
        jobs: input.jobs,
        stages: input.stages,
      }).slice(0, 90000),
      text: { format: { type: "json_schema", name: "ai_recruiter_result", strict: true, schema: recruiterResultJsonSchema } },
    },
  });
  if (!response.ok) throw new Error("AI_UNAVAILABLE");
  const raw = responseOutputText(await response.json()).trim() || null;
  if (!raw) throw new Error("AI_INVALID_OUTPUT");
  return resultSchema.parse(JSON.parse(raw));
}
