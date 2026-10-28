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

// 문의가 쌓일 탭 이름
var SHEET_NAME = '문의';

var HEADERS = ['받은 시각', '성함', '연락처', '메일 주소', '문의 내용', '처리 상태', '메모'];

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

    var sheet = getSheet_();
    sheet.appendRow([new Date(), asText_(name), asText_(phone), asText_(email), asText_(message), '새 문의', '']);

    // 메일 알림. 하루 메일 한도를 넘는 등 실패해도 시트 저장은 이미 끝났으므로 손님에게는 성공으로 알립니다.
    try {
      sendNotice_(name, phone, email, message);
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
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
