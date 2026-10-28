/**
 * 홈페이지 문의 → 구글 스프레드시트 + 메일 알림
 *
 * 이 코드를 구글 시트의 [확장 프로그램] > [Apps Script]에 통째로 붙여 넣으세요.
 * 설정 방법은 같은 폴더의 "설정_방법.md"를 보세요.
 *
 * 하는 일
 *  1. 홈페이지에서 문의가 오면 "문의" 탭에 한 줄을 추가합니다.
 *  2. 사장님 메일로 알림을 보냅니다. (손님이 메일 주소를 적었다면 메일에서 "답장"만 누르면 손님에게 갑니다.)
 */

// 알림을 받을 메일 주소. 비워 두면 이 시트를 만든 구글 계정 메일로 받습니다.
var NOTIFY_EMAIL = '';

// 문의를 저장할 구글 시트의 ID (시트 주소의 /d/ 와 /edit 사이 글자). 시트 안에서 Apps Script를 열었다면 비워 둬도 됩니다.
var SHEET_ID = '';

// 문의가 쌓일 탭 이름
var SHEET_NAME = '문의';

var HEADERS = ['받은 시각', '성함', '연락처', '메일 주소', '문의 내용', '처리 상태', '메모'];

/* 스팸 방지 기준 (숫자만 바꾸면 됩니다) */
var MIN_FILL_SECONDS = 3;    // 페이지를 연 뒤 이 시간보다 빨리 보내면 봇으로 보고 버림
var DUP_MINUTES = 10;        // 같은 사람이 같은 내용을 이 시간 안에 다시 보내면 한 번만 저장
var PER_PERSON_LIMIT = 5;    // 같은 연락처나 메일로 6시간 동안 받을 수 있는 최대 건수
var HOURLY_LIMIT = 40;       // 한 시간 동안 받을 수 있는 전체 최대 건수 (넘으면 잠시 뒤 다시 보내 달라고 안내)
var HOURLY_MAIL_LIMIT = 5;   // 한 시간에 개별 알림 메일은 이 건수까지만. 넘으면 "몰리는 중" 메일 한 통만 보냄

/** 홈페이지에서 보내기를 누르면 실행됩니다. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // 여러 문의가 동시에 와도 줄이 섞이지 않게 차례로 처리
  } catch (err) {
    return reply_({ ok: false, error: 'busy' });
  }
  try {
    var p = (e && e.parameter) || {};

    // 스팸 로봇이 숨은 칸을 채웠으면 저장하지 않고 조용히 끝냅니다.
    if (p.botcheck) return reply_({ ok: true });

    var name = clip_(p.name, 40);
    var phone = clip_(p.phone, 20);
    var email = clip_(p.email, 80);
    var message = clip_(p.message, 2000);
    if (!name || !message || (!phone && !email)) return reply_({ ok: false, error: 'missing' });

    // 페이지를 열자마자 보낸 것은 봇으로 보고 조용히 버립니다.
    var elapsed = Number(p.t);
    if (!(elapsed >= MIN_FILL_SECONDS * 1000)) return reply_({ ok: true });

    var cache = CacheService.getScriptCache();
    var hourKey = 'h_' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHH');

    // 한 시간 전체 한도
    var hourCount = Number(cache.get(hourKey) || 0);
    if (hourCount >= HOURLY_LIMIT) return reply_({ ok: false, error: 'limit' });

    // 같은 사람이 같은 내용을 반복해서 보낸 경우 : 한 번만 저장하고 손님에게는 성공으로 안내
    var who = (phone.replace(/[^0-9]/g, '') || '') + '|' + email.toLowerCase();
    var dupKey = 'd_' + hash_(who + '|' + message.replace(/\s+/g, ' '));
    if (cache.get(dupKey)) return reply_({ ok: true });

    // 같은 사람 횟수 한도
    var personKey = 'p_' + hash_(who);
    var personCount = Number(cache.get(personKey) || 0);
    if (personCount >= PER_PERSON_LIMIT) return reply_({ ok: false, error: 'limit' });

    var sheet = getSheet_();
    sheet.appendRow([new Date(), asText_(name), asText_(phone), asText_(email), asText_(message), '새 문의', '']);

    cache.put(hourKey, String(hourCount + 1), 3600);
    cache.put(dupKey, '1', DUP_MINUTES * 60);
    cache.put(personKey, String(personCount + 1), 21600);

    // 메일 알림. 실패해도 시트 저장은 이미 끝났으므로 손님에게는 성공으로 알립니다.
    try {
      var mailKey = 'm_' + hourKey;
      var mailCount = Number(cache.get(mailKey) || 0);
      if (mailCount < HOURLY_MAIL_LIMIT) {
        sendNotice_(name, phone, email, message);
      } else if (mailCount === HOURLY_MAIL_LIMIT) {
        sendBurstNotice_();
      }
      cache.put(mailKey, String(mailCount + 1), 3600);
    } catch (mailErr) {
      console.error('메일 알림 실패 : ' + mailErr);
    }
    return reply_({ ok: true });
  } catch (err) {
    console.error(err);
    return reply_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/** 웹 앱 주소를 브라우저로 열었을 때 정상 작동 여부를 보여 줍니다. */
function doGet() {
  return reply_({ ok: true, message: '문의 접수 주소가 정상 작동 중입니다.' });
}

/**
 * 처음 한 번만 직접 실행하세요. (편집기 위쪽에서 "처음_설정" 선택 후 [실행])
 * 구글이 권한을 물어보면 허용하면 되고, "문의" 탭이 만들어지고 시험 메일이 한 통 옵니다.
 */
function 처음_설정() {
  var sheet = getSheet_();
  sendNotice_('설정 시험', '010-0000-0000', '', '이 메일이 왔다면 알림 설정이 끝난 것입니다. 시트 주소 : ' + sheet.getParent().getUrl());
}

/* ---------- 아래는 내부에서 쓰는 도구입니다. 고치지 않아도 됩니다. ---------- */

function getSheet_() {
  var ss = ss_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#f5f5f7');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(5, 420);
    sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
    sheet.getRange('E:E').setWrap(true);
  }
  return sheet;
}

function sendNotice_(name, phone, email, message) {
  var to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  var sheetUrl = ss_().getUrl();
  var body =
    '홈페이지로 새 문의가 들어왔습니다.\n\n' +
    '성함 : ' + name + '\n' +
    '연락처 : ' + (phone || '(적지 않음)') + '\n' +
    '메일 주소 : ' + (email || '(적지 않음)') + '\n\n' +
    '문의 내용\n' + message + '\n\n' +
    '전체 문의 목록 : ' + sheetUrl + '\n';
  var options = { name: '홈페이지 문의 알림' };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) options.replyTo = email;
  MailApp.sendEmail(to, '[홈페이지 문의] ' + name.replace(/\s+/g, ' ') + ' 님', body, options);
}

// 문의가 한꺼번에 몰릴 때 개별 메일 대신 한 번만 보내는 알림
function sendBurstNotice_() {
  var to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  var sheetUrl = ss_().getUrl();
  MailApp.sendEmail(to, '[홈페이지 문의] 문의가 몰리고 있습니다',
    '지난 한 시간 동안 문의가 ' + HOURLY_MAIL_LIMIT + '건을 넘었습니다.\n' +
    '메일함이 가득 차지 않도록 이번 시간에는 개별 알림을 멈춥니다. 문의는 시트에 계속 저장됩니다.\n\n' +
    '시트에서 확인하기 : ' + sheetUrl + '\n', { name: '홈페이지 문의 알림' });
}

// 문의를 저장할 시트를 엽니다.
function ss_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

// 연락처나 내용을 짧은 열쇠 문자로 바꿉니다. (원문은 저장하지 않음)
function hash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}

// 앞뒤 공백을 지우고 길이를 제한합니다.
function clip_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// 앞에 ' 를 붙여 글자 그대로 저장합니다. (010이 10으로 바뀌거나, =로 시작하는 글이 수식으로 실행되는 것을 막음)
function asText_(v) {
  return v ? "'" + v : '';
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
