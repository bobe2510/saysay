// Default phrase board. Edited copies are stored in localStorage on the device.
// Fields: emoji, text (shown on tile), say (optional, what is spoken instead of text).
window.DEFAULT_BOARD = {
  version: 1,
  quick: [
    { id: 'q-yes', emoji: '✅', text: '是', kind: 'yes' },
    { id: 'q-no', emoji: '❌', text: '不是', kind: 'no' },
    { id: 'q-idk', emoji: '🤷', text: '不知道', kind: 'idk' }
  ],
  categories: [
    {
      name: '常用', emoji: '💬', color: 'teal',
      items: [
        { emoji: '💨', text: '我要抽痰', say: '我要抽痰' },
        { emoji: '🔄', text: '幫我翻身' },
        { emoji: '😣', text: '我會痛' },
        { emoji: '😮‍💨', text: '呼吸不順', say: '我呼吸不太順' },
        { emoji: '👄', text: '嘴巴好乾' },
        { emoji: '🥵', text: '太熱了' },
        { emoji: '🥶', text: '太冷了' },
        { emoji: '🤚', text: '幫我抓癢' },
        { emoji: '👩‍⚕️', text: '叫護理師', say: '請幫我叫護理師' },
        { emoji: '✋', text: '等一下' },
        { emoji: '🙏', text: '謝謝' },
        { emoji: '❓', text: '不在這裡', say: '我要說的不在這裡，請用問的' }
      ]
    },
    {
      name: '照顧', emoji: '🛏️', color: 'blue',
      items: [
        { emoji: '⬆️', text: '床頭抬高', say: '幫我把床頭抬高' },
        { emoji: '⬇️', text: '床頭放低', say: '幫我把床頭放低' },
        { emoji: '🛏️', text: '調整枕頭', say: '幫我調整枕頭' },
        { emoji: '🧻', text: '擦臉', say: '幫我擦臉' },
        { emoji: '👀', text: '擦眼睛', say: '幫我擦眼睛' },
        { emoji: '🩲', text: '換尿布', say: '幫我換尿布' },
        { emoji: '💩', text: '想大便', say: '我想大便' },
        { emoji: '❄️', text: '冷氣', say: '冷氣幫我調一下' },
        { emoji: '💡', text: '開燈', say: '幫我開燈' },
        { emoji: '🌙', text: '關燈', say: '幫我關燈' },
        { emoji: '📺', text: '開電視', say: '幫我開電視' },
        { emoji: '🔇', text: '關電視', say: '幫我關電視' }
      ]
    },
    {
      name: '哪裡不舒服', emoji: '📍', color: 'orange',
      items: [
        { emoji: '🧑', text: '頭', say: '我的頭不舒服' },
        { emoji: '👁️', text: '眼睛', say: '我的眼睛不舒服' },
        { emoji: '🗣️', text: '喉嚨', say: '我的喉嚨不舒服' },
        { emoji: '⭕', text: '氣切口', say: '我的氣切口不舒服' },
        { emoji: '🧣', text: '脖子', say: '我的脖子不舒服' },
        { emoji: '🤷', text: '肩膀', say: '我的肩膀不舒服' },
        { emoji: '🫁', text: '胸口', say: '我的胸口不舒服' },
        { emoji: '🫃', text: '肚子', say: '我的肚子不舒服' },
        { emoji: '🧍', text: '背', say: '我的背不舒服' },
        { emoji: '🍑', text: '屁股', say: '我的屁股不舒服' },
        { emoji: '✋', text: '手', say: '我的手不舒服' },
        { emoji: '🦶', text: '腳', say: '我的腳不舒服' }
      ]
    },
    {
      name: '心情', emoji: '❤️', color: 'pink',
      items: [
        { emoji: '🙂', text: '我還好' },
        { emoji: '😩', text: '我很累' },
        { emoji: '😨', text: '我很害怕' },
        { emoji: '😠', text: '我很煩' },
        { emoji: '🏠', text: '我想家' },
        { emoji: '🤝', text: '陪陪我', say: '陪我一下' },
        { emoji: '😴', text: '讓我休息', say: '讓我休息一下' },
        { emoji: '😢', text: '我想哭' },
        { emoji: '😌', text: '不要擔心', say: '你們不要擔心' },
        { emoji: '❤️', text: '我愛你們' },
        { emoji: '🙇', text: '辛苦了', say: '你們辛苦了' },
        { emoji: '💤', text: '我想睡' }
      ]
    },
    {
      name: '找人', emoji: '👪', color: 'purple',
      items: [
        { emoji: '👵', text: '老伴', say: '我想找老伴' },
        { emoji: '👨', text: '兒子', say: '我想找兒子' },
        { emoji: '👩', text: '女兒', say: '我想找女兒' },
        { emoji: '🧑', text: '女婿', say: '我想找女婿' },
        { emoji: '🧒', text: '孫子', say: '我想看孫子' },
        { emoji: '🧑‍⚕️', text: '醫生', say: '我想跟醫生說話' },
        { emoji: '👩‍⚕️', text: '護理師', say: '請護理師過來' },
        { emoji: '🫁', text: '呼吸治療師', say: '請呼吸治療師過來' },
        { emoji: '🙋', text: '看護', say: '請看護過來' },
        { emoji: '📞', text: '打電話', say: '我想打電話' },
        { emoji: '📱', text: '視訊', say: '我想視訊' }
      ]
    },
    {
      name: '我想問', emoji: '❓', color: 'green',
      items: [
        { emoji: '🕐', text: '現在幾點？' },
        { emoji: '📅', text: '今天幾號？' },
        { emoji: '🩺', text: '我的狀況？', say: '我現在的狀況怎麼樣？' },
        { emoji: '💬', text: '醫生怎麼說？' },
        { emoji: '🚪', text: '誰會來看我？' },
        { emoji: '🏡', text: '何時回家？', say: '我什麼時候可以回家？' },
        { emoji: '🗣️', text: '何時能說話？', say: '我什麼時候可以戴發聲閥說話？' },
        { emoji: '💊', text: '吃藥了嗎？', say: '我吃藥了嗎？' },
        { emoji: '🏠', text: '家裡好嗎？', say: '家裡還好嗎？' },
        { emoji: '💰', text: '醫藥費？', say: '醫藥費的事情還好嗎？' }
      ]
    }
  ]
};
