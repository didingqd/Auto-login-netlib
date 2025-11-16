const axios = require('axios');
const { chromium } = require('playwright');

const token = process.env.BOT_TOKEN;
const chatId = process.env.CHAT_ID;
const accounts = process.env.ACCOUNTS;
const wecomWebhook = process.env.WECOM_WEBHOOK;

if (!accounts) {
  console.log('❌ 未配置账号');
  process.exit(1);
}

// 解析多个账号，支持逗号或分号分隔
const accountList = accounts.split(/[,;]/).map(account => {
  const [user, pass] = account.split(":").map(s => s.trim());
  return { user, pass };
}).filter(acc => acc.user && acc.pass);

if (accountList.length === 0) {
  console.log('❌ 账号格式错误，应为 username1:password1,username2:password2');
  process.exit(1);
}

// 获取IP地址和地理位置信息
async function getIpLocation() {
  try {
    // 使用 ip-api.com 免费API获取IP和位置信息
    const response = await axios.get('http://ip-api.com/json/', {
      timeout: 5000
    });
    
    if (response.data && response.data.status === 'success') {
      const data = response.data;
      const location = `${data.country || ''}${data.regionName ? ' - ' + data.regionName : ''}${data.city ? ' - ' + data.city : ''}`.trim();
      return {
        ip: data.query,
        location: location || '未知位置',
        country: data.country || '未知',
        city: data.city || '未知',
        isp: data.isp || '未知'
      };
    }
  } catch (e) {
    console.log('⚠️ 获取IP位置信息失败:', e.message);
  }
  
  // 如果第一个API失败，尝试备用API
  try {
    const response = await axios.get('https://ipapi.co/json/', {
      timeout: 5000
    });
    
    if (response.data && response.data.ip) {
      const data = response.data;
      const location = `${data.country_name || ''}${data.region ? ' - ' + data.region : ''}${data.city ? ' - ' + data.city : ''}`.trim();
      return {
        ip: data.ip,
        location: location || '未知位置',
        country: data.country_name || '未知',
        city: data.city || '未知',
        isp: data.org || '未知'
      };
    }
  } catch (e) {
    console.log('⚠️ 备用IP位置API也失败:', e.message);
  }
  
  return {
    ip: '未知',
    location: '未知位置',
    country: '未知',
    city: '未知',
    isp: '未知'
  };
}

async function sendTelegram(message) {
  if (!token || !chatId) return;

  const now = new Date();
  const hkTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timeStr = hkTime.toISOString().replace('T', ' ').substr(0, 19) + " HKT";

  const fullMessage = `🎉 Netlib 登录通知\n\n登录时间：${timeStr}\n\n${message}`;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: fullMessage
    }, { timeout: 10000 });
    console.log('✅ Telegram 通知发送成功');
  } catch (e) {
    console.log('⚠️ Telegram 发送失败');
  }
}

async function sendWeCom(message) {
  if (!wecomWebhook) {
    console.log('⚠️ 企业微信 webhook 未配置，跳过企业微信通知');
    return;
  }

  console.log('📤 正在发送企业微信通知...');

  const now = new Date();
  const hkTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timeStr = hkTime.toISOString().replace('T', ' ').substr(0, 19) + " HKT";

  const fullMessage = `🎉 Netlib 登录通知\n\n登录时间：${timeStr}\n\n${message}`;

  try {
    // 企业微信支持 markdown 和 text 两种格式，优先使用 markdown
    const response = await axios.post(wecomWebhook, {
      msgtype: 'markdown',
      markdown: {
        content: fullMessage
      }
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // 检查企业微信返回结果
    if (response.data && response.data.errcode === 0) {
      console.log('✅ 企业微信通知发送成功');
      return; // 发送成功，直接返回
    } else {
      throw new Error(`企业微信返回错误: ${JSON.stringify(response.data)}`);
    }
  } catch (e) {
    console.log(`⚠️ 企业微信 markdown 格式发送失败: ${e.message}`);
    if (e.response && e.response.data) {
      console.log(`   错误详情: ${JSON.stringify(e.response.data)}`);
    }
    // 如果 markdown 失败，尝试使用 text 格式
    try {
      const response = await axios.post(wecomWebhook, {
        msgtype: 'text',
        text: {
          content: fullMessage,
          mentioned_list: [] // 可以在这里添加 @ 的用户列表
        }
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data && response.data.errcode === 0) {
        console.log('✅ 企业微信通知发送成功 (text格式)');
      } else {
        throw new Error(`企业微信返回错误: ${JSON.stringify(response.data)}`);
      }
    } catch (e2) {
      console.log(`❌ 企业微信发送失败: ${e2.message}`);
      if (e2.response && e2.response.data) {
        console.log(`   错误详情: ${JSON.stringify(e2.response.data)}`);
      }
    }
  }
}

async function loginWithAccount(user, pass) {
  console.log(`\n🚀 开始登录账号: ${user}`);
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  let page;
  let result = { user, success: false, message: '' };
  
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    
    console.log(`📱 ${user} - 正在访问网站...`);
    await page.goto('https://www.netlib.re/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    console.log(`🔑 ${user} - 点击登录按钮...`);
    await page.click('text=Login', { timeout: 5000 });
    
    await page.waitForTimeout(2000);
    
    console.log(`📝 ${user} - 填写用户名...`);
    await page.fill('input[name="username"], input[type="text"]', user);
    await page.waitForTimeout(1000);
    
    console.log(`🔒 ${user} - 填写密码...`);
    await page.fill('input[name="password"], input[type="password"]', pass);
    await page.waitForTimeout(1000);
    
    console.log(`📤 ${user} - 提交登录...`);
    await page.click('button:has-text("Validate"), input[type="submit"]');
    
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);
    
    // 检查登录是否成功
    const pageContent = await page.content();
    
    if (pageContent.includes('exclusive owner') || pageContent.includes(user)) {
      console.log(`✅ ${user} - 登录成功`);
      result.success = true;
      
      // 获取IP和位置信息
      console.log(`🌐 ${user} - 正在获取IP和位置信息...`);
      const ipInfo = await getIpLocation();
      result.ipInfo = ipInfo;
      result.message = `✅ ${user} 登录成功\n📍 IP地址: ${ipInfo.ip}\n🌍 位置: ${ipInfo.location}`;
      
      console.log(`📍 ${user} - IP: ${ipInfo.ip}, 位置: ${ipInfo.location}`);
    } else {
      console.log(`❌ ${user} - 登录失败`);
      
      // 即使登录失败也尝试获取IP信息
      console.log(`🌐 ${user} - 正在获取IP和位置信息...`);
      const ipInfo = await getIpLocation();
      result.ipInfo = ipInfo;
      result.message = `❌ ${user} 登录失败\n📍 IP地址: ${ipInfo.ip}\n🌍 位置: ${ipInfo.location}`;
    }
    
  } catch (e) {
    console.log(`❌ ${user} - 登录异常: ${e.message}`);
    
    // 即使发生异常也尝试获取IP信息
    try {
      console.log(`🌐 ${user} - 正在获取IP和位置信息...`);
      const ipInfo = await getIpLocation();
      result.ipInfo = ipInfo;
      result.message = `❌ ${user} 登录异常: ${e.message}\n📍 IP地址: ${ipInfo.ip}\n🌍 位置: ${ipInfo.location}`;
    } catch (ipErr) {
      result.message = `❌ ${user} 登录异常: ${e.message}`;
    }
  } finally {
    if (page) await page.close();
    await browser.close();
  }
  
  return result;
}

async function main() {
  console.log(`🔍 发现 ${accountList.length} 个账号需要登录`);
  
  // 检查通知配置
  if (token && chatId) {
    console.log('✅ Telegram 通知已配置');
  } else {
    console.log('⚠️ Telegram 通知未配置');
  }
  
  if (wecomWebhook) {
    console.log('✅ 企业微信通知已配置');
  } else {
    console.log('⚠️ 企业微信通知未配置 (请设置 WECOM_WEBHOOK 环境变量)');
  }
  
  const results = [];
  
  for (let i = 0; i < accountList.length; i++) {
    const { user, pass } = accountList[i];
    console.log(`\n📋 处理第 ${i + 1}/${accountList.length} 个账号: ${user}`);
    
    const result = await loginWithAccount(user, pass);
    results.push(result);
    
    // 如果不是最后一个账号，等待一下再处理下一个
    if (i < accountList.length - 1) {
      console.log('⏳ 等待3秒后处理下一个账号...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // 汇总所有结果并发送一条消息
  const successCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  let summaryMessage = `📊 登录汇总: ${successCount}/${totalCount} 个账号成功\n\n`;
  
  results.forEach((result, index) => {
    summaryMessage += `${result.message}`;
    // 如果有IP信息，添加更多详细信息
    if (result.ipInfo && result.ipInfo.ip !== '未知') {
      summaryMessage += `\n   └─ ISP: ${result.ipInfo.isp}`;
    }
    // 如果不是最后一个结果，添加分隔
    if (index < results.length - 1) {
      summaryMessage += `\n\n`;
    }
  });
  
  // 并行发送 Telegram 和企业微信通知
  await Promise.all([
    sendTelegram(summaryMessage),
    sendWeCom(summaryMessage)
  ]);
  
  console.log('\n✅ 所有账号处理完成！');
}

main().catch(console.error);
