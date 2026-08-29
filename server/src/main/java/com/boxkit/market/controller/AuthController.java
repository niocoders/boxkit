package com.boxkit.market.controller;

import cn.dev33.satoken.stp.StpUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boxkit.market.common.R;
import com.boxkit.market.entity.User;
import com.boxkit.market.mapper.UserMapper;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Map;

/** 注册 / 登录（Sa-Token）/ 当前用户。 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserMapper userMapper;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthController(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    public static class LoginReq {
        public String username;
        public String password;
    }

    public static class RegisterReq {
        public String username;
        public String password;
        public String nickname;
    }

    @PostMapping("/register")
    public R<Map<String, Object>> register(@RequestBody RegisterReq req) {
        if (req.username == null || req.username.isBlank() || req.password == null || req.password.length() < 6) {
            return R.error(400, "用户名不能为空，密码至少 6 位");
        }
        User exist = userMapper.selectOne(new LambdaQueryWrapper<User>()
                .eq(User::getUsername, req.username).last("LIMIT 1"));
        if (exist != null) return R.error(400, "用户名已被占用");

        User u = new User();
        u.username = req.username.trim();
        u.password = encoder.encode(req.password);
        u.nickname = (req.nickname == null || req.nickname.isBlank()) ? req.username : req.nickname;
        u.createdAt = LocalDateTime.now();
        userMapper.insert(u);
        return R.ok(Map.of("id", u.id, "username", u.username));
    }

    @PostMapping("/login")
    public R<Map<String, Object>> login(@RequestBody LoginReq req) {
        User u = userMapper.selectOne(new LambdaQueryWrapper<User>()
                .eq(User::getUsername, req.username == null ? "" : req.username).last("LIMIT 1"));
        if (u == null || !encoder.matches(req.password == null ? "" : req.password, u.password)) {
            return R.error(400, "用户名或密码错误");
        }
        StpUtil.login(u.id);
        return R.ok(Map.of(
                "token", StpUtil.getTokenValue(),
                "tokenName", StpUtil.getTokenName(),
                "nickname", u.nickname == null ? u.username : u.nickname
        ));
    }

    /** 当前登录用户（需 Sa-Token header: boxkit-token） */
    @GetMapping("/me")
    public R<Map<String, Object>> me() {
        long uid = StpUtil.getLoginIdAsLong();
        User u = userMapper.selectById(uid);
        if (u == null) return R.error(404, "用户不存在");
        return R.ok(Map.of("id", u.id, "username", u.username, "nickname", u.nickname));
    }
}
