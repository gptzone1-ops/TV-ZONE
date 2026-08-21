import fetchImapCode from "../server/api/fetch-imap-code.js";
import fetchOsnCode from "../server/api/fetch-osn-code.js";
import notifyExtraCredit from "../server/api/notify-extra-credit.js";
import receiveCode from "../server/api/receive-code.js";
import resetCompensationLinks from "../server/api/reset-compensation-links.js";
import rotateOsnMonthlyCycle from "../server/api/rotate-osn-monthly-cycle.js";
import reviewCreditRequest from "../server/api/review-credit-request.js";
import saveImapCredential from "../server/api/save-imap-credential.js";
import telegramWebhook from "../server/api/telegram-webhook.js";
import temporaryAccount from "../server/api/temporary-account.js";

export const config = { maxDuration: 300 };

const handlers = {
  "fetch-imap-code": fetchImapCode,
  "fetch-osn-code": fetchOsnCode,
  "notify-extra-credit": notifyExtraCredit,
  "receive-code": receiveCode,
  "reset-compensation-links": resetCompensationLinks,
  "rotate-osn-monthly-cycle": rotateOsnMonthlyCycle,
  "review-credit-request": reviewCreditRequest,
  "save-imap-credential": saveImapCredential,
  "telegram-webhook": telegramWebhook,
  "temporary-account": temporaryAccount,
};

export default async function handler(req, res) {
  const action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
  const actionHandler = handlers[String(action || "")];
  if (!actionHandler) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).json({ success: false, error: "api_route_not_found" });
  }
  return actionHandler(req, res);
}
