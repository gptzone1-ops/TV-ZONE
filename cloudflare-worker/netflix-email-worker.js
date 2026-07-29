const tvApprovalLinkPattern = /https?:\/\/(?:www\.)?netflix\.com\/ilum\?code=[\w-]+/i;

function extractSignInCode(rawEmail) {
  return rawEmail.match(/Sign In Code[\s\S]{0,800}?(\d{4})/i)?.[1] || null;
}

export default {
  async email(message, env) {
    const rawEmail = await new Response(message.raw).text();
    const code = extractSignInCode(rawEmail);
    const tvLinkMatch = rawEmail.match(tvApprovalLinkPattern);
    const tvApprovalUrl = tvLinkMatch?.[0] || null;

    if (!code && !tvApprovalUrl) return;

    const webhookUrl = env.RECEIVE_CODE_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error("RECEIVE_CODE_WEBHOOK_URL is not configured");
    }

    const headers = { "Content-Type": "application/json" };
    if (env.RECEIVE_CODE_WEBHOOK_SECRET) {
      headers.Authorization = `Bearer ${env.RECEIVE_CODE_WEBHOOK_SECRET}`;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: env.ACCOUNT_EMAIL_OVERRIDE || message.to,
        code,
        tv_approval_url: tvApprovalUrl,
        created_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Zone webhook failed with status ${response.status}`);
    }
  },
};
