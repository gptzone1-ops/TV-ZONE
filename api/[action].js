import adminCompensations from "../server/api/admin-compensations.js";
import compensation from "../server/api/compensation.js";
import createCustomerLinks from "../server/api/create-customer-links.js";
import fetchImapCode from "../server/api/fetch-imap-code.js";
import notifyExtraCredit from "../server/api/notify-extra-credit.js";
import receiveCode from "../server/api/receive-code.js";
import resetCompensationLinks from "../server/api/reset-compensation-links.js";
import resetExternalCodeAccess from "../server/api/reset-external-code-access.js";
import reviewCreditRequest from "../server/api/review-credit-request.js";
import saveImapCredential from "../server/api/save-imap-credential.js";
import telegramWebhook from "../server/api/telegram-webhook.js";
import temporaryAccount from "../server/api/temporary-account.js";
import updateAccount from "../server/api/update-account.js";
import useExternalCode from "../server/api/use-external-code.js";

export const config = { maxDuration: 300 };

const handlers = {
  "admin-compensations": adminCompensations,
  compensation,
  "create-customer-links": createCustomerLinks,
  "fetch-imap-code": fetchImapCode,
  "notify-extra-credit": notifyExtraCredit,
  "receive-code": receiveCode,
  "reset-compensation-links": resetCompensationLinks,
  "reset-external-code-access": resetExternalCodeAccess,
  "review-credit-request": reviewCreditRequest,
  "save-imap-credential": saveImapCredential,
  "telegram-webhook": telegramWebhook,
  "temporary-account": temporaryAccount,
  "update-account": updateAccount,
  "use-external-code": useExternalCode,
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
